const express = require('express');
const app = express();
const path = require("path");
const fs = require("fs");
const axios = require('axios');


const port = 3000;
app.set('view engine', 'ejs');

app.use(express.static('public'));

async function main(){
  const OpenAI = require('openai')
  const openai = new OpenAI()
  const assistant = await openai.beta.assistants.create({
    name: "Lucerna",
    // PHASE 1
    instructions: "You are Lucerna, the Personal Health Assistant for Space Exploration. You are to monitor an astronaut's physical and mental health status, providing medical advice and companionship. Be sure to also focus on providing comfort for mental well-being. You will be periodically given system messages with the astronaut's status, and should only respond when helpful or necessary for the astronaut's well-being (otherwise, send a blank message). However, if the astronaut addresses you directly, please do acknowledge them. These messages are read aloud, so please keep them concise. The astronaut's messages are also said aloud, so pick up on typos if appropriate. If you need to send an emergency message to mission control, separate the message to the astronaut and the mission control message with [MISSION_CONTROL], sending your message AFTER the tag's closed brackets (not inside). Please do respond to the astronaut as well before this tag is placed– try to comfort them if their vitals are critical. Only send raw text (no asterisks or formatting).",
    tools: [],
    model: "gpt-4o-mini"
  });
  let conversations = {};
  async function gptResponse(userMessage, threadID=0, role="user") {
    userMessage = userMessage + '.';
      if(threadID == 0){
          const thread = await openai.beta.threads.create();
          threadID = thread.id;
      }
      const message = await openai.beta.threads.messages.create(
          threadID,
          {
              role: "user",
              content: (role === "system" ? "If results aren't abnormal, refrain from responding. SYSTEM:" : "") + userMessage
          }
      );

      return new Promise((resolve, reject) => {
          let serviceResponse = "";

          openai.beta.threads.runs.stream(threadID, {
              assistant_id: assistant.id
          })
          .on('textDelta', async (textDelta) => {
              serviceResponse += textDelta.value;

              if (serviceResponse.includes("[END_MESSAGE]")) {
                resolve(JSON.stringify({message: serviceResponse.slice(0, serviceResponse.indexOf("[END_MESSAGE]")).trim(), id: threadID}));
              }
          })
          .on('error', (error) => {
              reject(error);
          });
      });
  }
  async function gptResponseRealtime(userMessage, threadID=0) { 
    
    if (threadID == 0) {
        let date = new Date();
        threadID = date.getTime() + Math.floor(Math.random() * 1000);
        conversations[threadID] = [];
        conversations[threadID].push({ role: 'system', content: "You are Lucerna, an AI that serves as a guiding light for students. You are a part of Internus, a service that provides easy access to internship and program opportunities for students. You be able to filter through these programs based on user data to get the best match for them. You also act as a mentor and guide for students. From just a quick chat with Lucerna, it'll learn all it needs to know about a student to provide them the best opportunities based on their strengths, interests and goals. On top of that, Lucerna can guide students through applications (in and out of Internus) and offer feedback on essays and submissions. This ensures students not only find opportunities, but also succeed in securing them. Only send raw text (no asterisks or formatting)."});
    }

    conversations[threadID].push({ role: 'user', content: userMessage });

    return new Promise(async (resolve, reject) => {
      try {
          const response = await axios.post(
              'https://api.openai.com/v1/chat/completions',
              {
                  model: 'gpt-4o-mini',
                  messages: conversations[threadID],
                  stream: true
              },
              {
                  headers: {
                      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                      'Content-Type': 'application/json'
                  },
                  responseType: 'stream' 
              }
          );

          let gptResponse = '';

          response.data.on('data', (chunk) => {
              const payloads = chunk.toString().split('\n\n');
              for (const payload of payloads) {
                  if (payload.startsWith('data:')) {
                      try {
                          if(payload.replace('data: ', '') !== '[DONE]'){
                            const data = JSON.parse(payload.replace('data: ', ''));
                            if (data.choices && data.choices.length) {
                                const delta = data.choices[0].delta;
                                if (delta && delta.content) {
                                    gptResponse += delta.content;
                                }
                            }
                          }
                      } catch (err) {
                          console.error("Error parsing JSON chunk:", err);
                      }
                  }
              }
          });

          response.data.on('end', () => {
              conversations[threadID].push({ role: 'assistant', content: gptResponse });
              console.log(gptResponse);
              resolve(JSON.stringify({ message: gptResponse, id: threadID }));
          });

          response.data.on('error', (err) => {
              reject(err);
          });

      } catch (error) {
          console.error('Error:', error.response ? error.response.data : error.message);
          reject(error);
      }
  });
}
  
  app.get('/', async (req, res) => {
    res.render("index", {gptResponse: await gptResponse})
  })
  
  const locationsRouter = require('./routes/locations')
  
  app.use('/locations', locationsRouter)

  var threadSpeeches = {};
  app.post('/api/user-message', async (req, res) => {
    const userInput = req.query.input;
    const threadID = req.query.threadID;
    const requestedVoice = req.query.voice;
    try {
      res.json({ response: await getAudioResponse(userInput, threadID) });
    } catch (error) {
        console.error('Error getting GPT response:', error);
        res.status(500).json({ error: 'Failed to get response from GPT' });
    }
  });

  app.post('/api/system-message', async (req, res) => {
    const userInput = req.query.input;
    const threadID = req.query.threadID;
    const requestedVoice = req.query.voice;
    try {
          res.json({ response: await getAudioResponse(userInput, threadID, role="system") });
    } catch (error) {
        console.error('Error getting GPT response:', error);
        res.status(500).json({ error: 'Failed to get response from GPT' });
    }
});

async function getAudioResponse(userInput, threadID, queryRole="user", requestedVoice="alloy") {
  const gptResponseMessage = await gptResponseRealtime(userInput, threadID, queryRole);
  const parsedResponse = JSON.parse(gptResponseMessage);
  parsedResponse["message"] = parsedResponse.message.split("[MISSION_CONTROL]")[0].trim();

  // if (!threadSpeeches[parsedResponse.id]) {
  //     threadSpeeches[parsedResponse.id] = 1;
  // } else {
  //     threadSpeeches[parsedResponse.id]++;
  // }

  // const speechFile = path.resolve(`./public/speech/${parsedResponse.id}-${threadSpeeches[parsedResponse.id]}.mp3`);
  // parsedResponse["speechPath"] = `speech/${parsedResponse.id}-${threadSpeeches[parsedResponse.id]}.mp3`;

  // const mp3 = await openai.audio.speech.create({
  //     model: "gpt-4o-mini-tts",
  //     voice: requestedVoice,
  //     input: parsedResponse.message.replaceAll("*", ""),
  // });

  // const buffer = Buffer.from(await mp3.arrayBuffer());
  // await fs.promises.writeFile(speechFile, buffer);

  return JSON.stringify(parsedResponse);
}

  
  app.listen(port, () => {
    console.log(`App listening on port ${port}`)
  });

}

main();
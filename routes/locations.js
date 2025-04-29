const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  res.send('Locations')
})

module.exports = router
require('dotenv').config();
const mongoose = require('mongoose');

console.log('Testing URI:', process.env.MONGO_URI ? 'URI found in .env' : 'ERROR: MONGO_URI is missing from .env');

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log(' SUCCESS: Connected to MongoDB Atlas!');
    process.exit(0);
  })
  .catch(err => {
    console.log('\n--- EXACT REASON FOR FAILURE ---');
    if (err.reason && err.reason.servers) {
      for (const [server, desc] of err.reason.servers.entries()) {
        console.log(`Node: ${server}`);
        console.log('Actual error:', desc.error ? desc.error.message || desc.error : 'No specific error');
      }
    } else {
      console.log(err.message);
    }
    process.exit(1);
  });
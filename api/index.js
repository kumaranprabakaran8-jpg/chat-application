const serverless = require('serverless-http');
const app = require('../server');

// export both serverless handler (default) and raw app for local use
module.exports = serverless(app);
module.exports.app = app;

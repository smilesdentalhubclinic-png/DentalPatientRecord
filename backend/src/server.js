const config = require('./config');
const app = require('./app');

app.listen(config.port, () => {
  // Keep startup log concise and explicit for terminal usage.
  // eslint-disable-next-line no-console
  console.log(`Backend API listening on http://localhost:${config.port}`);
});

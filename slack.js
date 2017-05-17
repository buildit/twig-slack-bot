const rp = require('request-promise-native');

module.exports = class SlackWebApi {
  constructor(token) {
    this.baseUrl = 'https://YOURTEAM.slack.com/api/';
    this.token = token;
  }

  getChannelHistory(channelId) {
    return rp.get(`${this.baseUrl}channels.history?token=${this.token}&channel=${channelId}`);
  }

  getChannels() {
    return rp.get(`${this.baseUrl}channels.list?token=${this.token}`);
  }
};

const config = {
  api: 'http://staging.twig-api.riglet/v2',
  token: process.env.TOKEN,
  totalInterval: 60 * 60 * 24,
  interval: 60 * 60,
  name: 'slack-demo',
  email: 'ben.hernandez@corp.riglet.io',
  password: 'Z3nB@rnH3n',
  chatRooms: {
    group: {
      'engineering-usa': { activeMembers: [7, 20], messages: [2, 4], category: 'studio' },
      buildit: { activeMembers: [50, 80], messages: [5, 10], category: 'studio' },
    },
    channel: {
      'digital-delivery': { activeMembers: [10, 45], messages: [3, 6], category: 'tribe' },
      'platform-engineering': { activeMembers: [12, 50], messages: [5, 10], category: 'tribe' },
      'tribe-front-end-engin': { activeMembers: [10, 45], messages: [3, 6], category: 'tribe' },
      'tribe-mobile': { activeMembers: [7, 20], messages: [2, 4], category: 'tribe' },
      'creative-tech': { activeMembers: [9, 35], messages: [3, 6], category: 'tribe' },
      'denver-pod': { activeMembers: [3, 7], messages: [2, 4], category: 'studio' },
      'dublin-pod': { activeMembers: [8, 25], messages: [2, 4], category: 'studio' },
      'london-pod': { activeMembers: [50, 80], messages: [5, 10], category: 'studio' },
      'london-wework-pod': { activeMembers: [10, 45], messages: [3, 6], category: 'studio' },
      nycfolks: { activeMembers: [3, 8], messages: [2, 4], category: 'studio' },
      edinburgh: { activeMembers: [9, 33], messages: [3, 6], category: 'studio' },
    },
  },
};

module.exports = config;

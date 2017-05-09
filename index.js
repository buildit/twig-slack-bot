const Slack = require('slack-api').promisify();
const moment = require('moment');
require('moment-timezone');
const rp = require('request-promise-native');
const extent = require('d3-array').extent;
const powScale = require('d3-scale').scalePow;

const api = 'http://localhost:3000/v2';
const token = process.env.TOKEN;
const interval = 60 * 60;
const name = 'slack-analysis';


const chatRooms = {
  channel: {
    random: { activeMembers: [50, 70], messages: [5, 10] },
    twig: { activeMembers: [10, 15], messages: [2, 4] },
    'tech-support': { activeMembers: [40, 65], messages: [2, 4] },
  },
  group: {
    buildit: { activeMembers: [20, 40], messages: [2, 4] },
    'engineering-usa': { activeMembers: [8, 15], messages: [5, 10] },
  },
};

/**
 * Login and keep the cookie.
 *
 * @returns RequestPromise.
 */
function login() {
  const options = {
    method: 'POST',
    uri: `${api}/login`,
    body: {
      email: 'ben.hernandez@corp.riglet.io',
      password: 'Z3nB@rnH3n',
    },
    json: true,
    jar: true,
  };
  return rp(options);
}

/**
 * Gets the latest revision number from twiglet then patches the nodes and links.
 *
 * @param {any} twiglet
 * @returns RequestPromise
 */
function patchTwiglet(twiglet) {
  const getOptions = {
    method: 'GET',
    uri: `${api}/twiglets/${name}`,
    transform(body) {
      return JSON.parse(body);
    },
  };
  return rp(getOptions).then((response) => {
    const putOptions = {
      method: 'PATCH',
      uri: `${api}/twiglets/${name}`,
      body: {
        _rev: response._rev, // eslint-disable-line
        commitMessage: twiglet.commitMessage,
        links: twiglet.links,
        nodes: twiglet.nodes,
      },
      json: true,
      jar: true,
    };
    return rp(putOptions);
  });
}

/**
 * Creates an event on the twiglet.
 *
 * @param {any} eventName what the event should be called.
 * @returns RequestPromise
 */
function createEvent(eventName) {
  const postOptions = {
    method: 'POST',
    uri: `${api}/twiglets/${name}/events`,
    body: {
      name: eventName,
    },
    json: true,
    jar: true,
  };
  return rp(postOptions);
}

/**
 * Counts the members in each room.
 *
 * @param {any} members the members of the chat room
 * @param {any} users the total list of users
 * @returns RequestPromise
 */
function countMembers(members, users) {
  let active = 0;
  let inactive = 0;
  members.forEach((member) => {
    if (users[member].presence === 'away') {
      inactive += 1;
    } else {
      active += 1;
    }
  });
  return [active, inactive];
}

/**
 * Initializes an empty twiglet to pass around
 *
 * @param {any} commitMessage the commit message for this particular patch.
 * @returns RequestPromise
 */
function initializeTwiglet(commitMessage) {
  return {
    commitMessage,
    nodes: [],
    links: [],
  };
}

/**
 * Gets the color that this particular node should be.
 *
 * @param {any} channel the channel being checked for.
 * @param {any} key the node type.
 * @returns RequestPromise
 */
function getColor(channel, key) {
  const array = chatRooms[channel.type][channel.name][key];
  if (array) {
    if (channel[key] < array[0]) {
      return '#cc0000';
    } else if (channel[key] < array[0]) {
      return '#cccc00';
    }
    return '#006600';
  }
  return '#0066ff';
}

/**
 * Creates a bunch of nodes and links for this twiglet.
 *
 * @param {any} twiglet the twiglet created above
 * @param {any} channel the channel this specific set is for
 * @param {any} scaleFunctions functions for scaling the node.
 */
function createNodesAndLinks(twiglet, channel, scaleFunctions) {
  const channelNode = {
    name: channel.name,
    id: channel.id,
    type: channel.type,
    attrs: [],
  };
  twiglet.nodes.push(channelNode);
  const nodeKeys = ['members', 'activeMembers', 'inactiveMembers', 'messages'];
  nodeKeys.forEach((key) => {
    const size = Math.round(scaleFunctions[key](channel[key]));
    const keyNode = {
      name: `${key} - ${channel[key]}`,
      id: `${channel.id}-${key}`,
      _color: getColor(channel, key),
      _size: size,
      type: key,
      attrs: [],
    };
    twiglet.nodes.push(keyNode);
    const keyLink = {
      id: `${channel.id}-link-${key}`,
      source: channel.id,
      target: `${channel.id}-${key}`,
    };
    twiglet.links.push(keyLink);
  });
}

function getSummary() {
  let users = {};
  let channels = {};
  const now = moment(new Date()).utc();
  const timeIntervalAgo = now.subtract(interval, 'second').unix();

  return Slack.users.list({ token, presence: true })
  // Get the users from slack
  .then((usersResults) => {
    users = usersResults.members.reduce((object, member) =>
      Object.assign(object, { [member.id]: member }), {});
    return Slack.channels.list({ token });
  })
  // Get the channels from slack.
  .then((channelsResults) => {
    const promises = [];
    channels = channelsResults.channels
    .filter(channel => chatRooms.channel[channel.name])
    .reduce((object, channel) => {
      promises.push(Slack.channels.history({
        token,
        channel: channel.id,
        oldest: timeIntervalAgo,
      })
      .then(results => Object.assign(results, { name: channel.name })));
      const [activeMembers, inactiveMembers] = countMembers(channel.members, users);
      return Object.assign(object, {
        [channel.name]: {
          id: channel.id,
          name: channel.name,
          members: channel.members.length,
          activeMembers,
          inactiveMembers,
          type: 'channel',
        },
      });
    }, {});
    return Promise.all(promises);
  })
  // Get the messages from each slack channel.
  .then((messages) => {
    messages.forEach((message) => {
      channels[message.name].messages = message.messages.length;
    });
    return Slack.groups.list({ token });
  })
  // Get the groups from slack (locked channels)
  .then((groupResults) => {
    const promises = [];
    channels = groupResults.groups
    .filter(group => chatRooms.group[group.name])
    .reduce((object, group) => {
      promises.push(Slack.groups.history({
        token,
        channel: group.id,
        oldest: timeIntervalAgo,
      })
      .then(results => Object.assign(results, { name: group.name })));
      const [activeMembers, inactiveMembers] = countMembers(group.members, users);
      return Object.assign(object, {
        [group.name]: {
          id: group.id,
          name: group.name,
          members: group.members.length,
          activeMembers,
          inactiveMembers,
          type: 'group',
        },
      });
    }, channels);
    return Promise.all(promises);
  })
  // Get the messages from the group.
  .then((messages) => {
    messages.forEach((message) => {
      channels[message.name].messages = message.messages.length;
    });
  })
  .then(() => {
    const twiglet = initializeTwiglet(`${now.format('HH')}:00`);
    const domains = Reflect.ownKeys(channels).reduce((object, channelKey) => {
      const channel = channels[channelKey];
      object.members.push(channel.members);
      object.activeMembers.push(channel.activeMembers);
      object.inactiveMembers.push(channel.inactiveMembers);
      object.messages.push(channel.messages);
      return object;
    }, { members: [], activeMembers: [], inactiveMembers: [], messages: [] });
    const scaleFunctions = {
      members: powScale().exponent(1 / 3).range([10, 30]).domain(extent(domains.members)),
      activeMembers: powScale().exponent(1 / 3)
                      .range([10, 30]).domain(extent(domains.activeMembers)),
      inactiveMembers: powScale().exponent(1 / 3)
                      .range([10, 30]).domain(extent(domains.inactiveMembers)),
      messages: powScale().exponent(1 / 3).range([10, 30]).domain(extent(domains.messages)),
    };
    Reflect.ownKeys(channels).forEach(channelName =>
        createNodesAndLinks(twiglet, channels[channelName], scaleFunctions));
    login()
    .then(() => patchTwiglet(twiglet))
    .then(() => createEvent(now.toLocaleString()))
    .then(() => console.log('snapshot placed')) // eslint-disable-line
    .catch(error => console.error('error!', error.error)); // eslint-disable-line
  })
  .catch((error) => {
    console.warn(error); // eslint-disable-line
  });
}

getSummary();

setInterval(getSummary, interval * 1000);

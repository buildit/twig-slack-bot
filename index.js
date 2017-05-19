const Slack = require('slack-api').promisify();
const moment = require('moment');
const R = require('ramda');
require('moment-timezone');
const extent = require('d3-array').extent;
const powScale = require('d3-scale').scalePow;
const log4js = require('log4js');
const { login, patchTwiglet, createEvent } = require('./apiCalls');

const logger = log4js.getLogger();
const config = require('./config');


/**
 * Counts the members in each room.
 * Looks at the presence of each member, and based on that adds to away or inactive
 *
 * @param {any} members the members of the chat room
 * @param {any} users the total list of users
 * @returns RequestPromise
 */
function countMembers(members, users) {
  let activeMembers = 0;
  let inactiveMembers = 0;
  members.forEach((member) => {
    if (users[member].presence === 'away') {
      inactiveMembers += 1;
    } else {
      activeMembers += 1;
    }
  });
  return {
    activeMembers,
    inactiveMembers,
  };
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
  // array is a range based roughly on the channel's size
  const array = config.chatRooms[channel.type][channel.name][key];
  if (array) {
    if (channel[key] < array[0]) {
      return '#cc0000';
    } else if (channel[key] < array[1]) {
      return '#cccc00';
    }
    return '#006600';
  }
  // inactiveMembers and members will always render as blue
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
  const updatedTwiglet = R.clone(twiglet);
  const channelNode = {
    name: channel.name,
    id: channel.id,
    type: channel.type,
    attrs: [],
  };
  updatedTwiglet.nodes.push(channelNode);
  const nodeKeys = ['members', 'activeMembers', 'inactiveMembers', 'messages'];
  nodeKeys.forEach((key) => {
    const size = Math.round(scaleFunctions[key](channel[key]));
    const keyNode = {
      name: `${channel.name}: ${key} - ${channel[key]}`,
      id: `${channel.id}-${key}`,
      _color: getColor(channel, key),
      _size: size,
      type: key,
      attrs: [],
    };
    updatedTwiglet.nodes.push(keyNode);
    const keyLink = {
      id: `${channel.id}-link-${key}`,
      source: channel.id,
      target: `${channel.id}-${key}`,
    };
    updatedTwiglet.links.push(keyLink);
  });
  return updatedTwiglet;
}

function getScaleFunctions(channels) {
  const domains = Reflect.ownKeys(channels).reduce((object, channelKey) => {
    const channel = channels[channelKey];
    object.members.push(channel.members);
    object.activeMembers.push(channel.activeMembers);
    object.inactiveMembers.push(channel.inactiveMembers);
    object.messages.push(channel.messages);
    return object;
  }, { members: [], activeMembers: [], inactiveMembers: [], messages: [] });
  // scaleFunctions helps to generate the size of the nodes
  return {
    members: powScale().exponent(1 / 3).range([10, 30]).domain(extent(domains.members)),
    activeMembers: powScale().exponent(1 / 3)
                    .range([10, 30]).domain(extent(domains.activeMembers)),
    inactiveMembers: powScale().exponent(1 / 3)
                    .range([10, 30]).domain(extent(domains.inactiveMembers)),
    messages: powScale().exponent(1 / 3).range([10, 30]).domain(extent(domains.messages)),
  };
}

function channelsToObjects(users, filteredChannels) {
  return filteredChannels.reduce((object, channel) => {
    const { activeMembers, inactiveMembers } = countMembers(channel.members, users);
    return R.merge(object, {
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
}

function getMessagesFromChannelAsPromise(token, timeIntervalAgo) {
  return channel =>
    Slack.channels.history({
      token,
      channel: channel.id,
      oldest: timeIntervalAgo,
    })
    .then(results => Object.assign(results, { name: channel.name }));
}

function processChannels(users, timeIntervalAgo, filteringObject, channelsResults) {
  const filteredChannels = channelsResults.channels
    .filter(channel => filteringObject[channel.name]);
  const channelsObject = channelsToObjects(users, filteredChannels);
  return Promise.all(
    filteredChannels.map(getMessagesFromChannelAsPromise(config.token, timeIntervalAgo)))
    .then((messages) => {
      messages.forEach((message) => {
        channelsObject[message.name].messages = message.messages.length;
        return channelsObject;
      });
      return channelsObject;
    });
}

function getSummary() {
  let users = {};
  let channels = {};
  const now = moment(new Date()).utc();
  const timeIntervalAgo = now.subtract(config.totalInterval, 'second').unix();

  return Slack.users.list({ token: config.token, presence: true })
  // Get the users from slack
  .then((usersResults) => {
    users = usersResults.members.reduce((object, member) =>
      Object.assign(object, { [member.id]: member }), {});
  })
  // Get the channels from slack.
  .then(() =>
    Slack.channels.list({ token: config.token })
    .then(channelsResults =>
      processChannels(users, timeIntervalAgo, config.chatRooms.channel, channelsResults))
    .then((channelsObject) => {
      channels = channelsObject;
    }))
  // get the groups from slack (private channels)
  .then(() =>
    Slack.channels.list({ token: config.token })
    .then(channelsResults =>
      processChannels(users, timeIntervalAgo, config.chatRooms.group, channelsResults))
    .then((channelsObject) => {
      channels = R.merge(channels, channelsObject);
    }))
  .then(() => {
    console.log('channels?', channels);
    const twiglet = initializeTwiglet(`${now.format('HH')}:00 event created`);
    Reflect.ownKeys(channels).forEach(channelName =>
        createNodesAndLinks(twiglet, channels[channelName], getScaleFunctions(channels)));
    return login()
    .then(() => patchTwiglet(twiglet))
    .then(() => createEvent(now.toLocaleString()))
    .then(() => logger.log('snapshot placed'));
  })
  .catch(error => logger.error(error));
}

const eventInterval = setInterval(getSummary, config.interval * 1000);

function stopSummary() {
  clearInterval(eventInterval);
  console.log('stop summary'); // eslint-disable-line
}

getSummary();
setTimeout(() => stopSummary(), config.totalInterval * 1000);

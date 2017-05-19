const R = require('ramda');
const Slack = require('slack-api').promisify();
const extent = require('d3-array').extent;
const powScale = require('d3-scale').scalePow;
const { getColorForChannel, getColor, countMembers } = require('./colorsAndCounts');


/**
 * Creates a bunch of nodes and links for this twiglet.
 *
 * @param {any} twiglet the twiglet created above
 * @param {any} channel the channel this specific set is for
 * @param {any} scaleFunctions functions for scaling the node.
 */

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

function createNodesAndLinks(twiglet, channel, scaleFunctions, chatRoom) {
  const updatedTwiglet = R.clone(twiglet);
  const channelNode = {
    name: channel.name,
    id: channel.id,
    type: channel.type,
    _color: getColorForChannel(channel, chatRoom),
    attrs: [],
  };
  updatedTwiglet.nodes.push(channelNode);
  const nodeKeys = ['members', 'activeMembers', 'inactiveMembers', 'messages'];
  nodeKeys.forEach((key) => {
    const size = Math.round(scaleFunctions[key](channel[key]));
    const keyNode = {
      name: `${channel.name}: ${key} - ${channel[key]}`,
      id: `${channel.id}-${key}`,
      _color: getColor(channel, key, chatRoom),
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

function channelsToObjects(users, filteredChannels, type) {
  return filteredChannels.reduce((object, channel) => {
    const { activeMembers, inactiveMembers } = countMembers(channel.members, users);
    return R.merge(object, {
      [channel.name]: {
        id: channel.id,
        name: channel.name,
        members: channel.members.length,
        activeMembers,
        inactiveMembers,
        type,
      },
    });
  }, {});
}

function getMessagesFromChannelAsPromise(token, timeIntervalAgo, type) {
  return channel =>
    Slack[`${type}s`].history({
      token,
      channel: channel.id,
      oldest: timeIntervalAgo,
    })
    .then(results => Object.assign(results, { name: channel.name }));
}

function processChannels(token, users, timeIntervalAgo, filteringObject, channelsResults, type) {
  const filteredChannels = channelsResults[`${type}s`]
    .filter(channel => filteringObject[type][channel.name]);
  const channelsObject = channelsToObjects(users, filteredChannels, type);
  return Promise.all(
    filteredChannels.map(getMessagesFromChannelAsPromise(token, timeIntervalAgo, type)))
    .then((messages) => {
      messages.forEach((message) => {
        channelsObject[message.name].messages = message.messages.length;
        return channelsObject;
      });
      return channelsObject;
    });
}

function getAllChannels(token, users, timeIntervalAgo, filteringObject, type) {
  return Slack[`${type}s`].list({ token })
    .then(channelsResults =>
      processChannels(token, users, timeIntervalAgo, filteringObject, channelsResults, type));
}

function getAllUsers(token, presence = true) {
  return Slack.users.list({ token, presence });
}

module.exports = {
  getScaleFunctions,
  getAllChannels,
  createNodesAndLinks,
  getAllUsers,
};

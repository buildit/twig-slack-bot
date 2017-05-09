const Slack = require('slack-api').promisify();
const moment = require('moment');
require('moment-timezone');
const rp = require('request-promise-native');
const extent = require('d3-array').extent;
const powScale = require('d3-scale').scalePow;
const icons = require('./icons')();

const api = 'http://localhost:3000';
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

function putSnapshot(twiglet) {
  const options = {
    method: 'PUT',
    uri: `${api}/twiglets/${name}/snapshots`,
    body: {
      links: twiglet.links,
      model: twiglet.model,
      nodes: twiglet.nodes,
      snapshotDescription: twiglet.snapshotDescription,
      snapshotName: twiglet.snapshotName,
    },
    json: true,
    jar: true,
  };
  return rp(options);
}

function putTwigletModel(twigletModel) {
  const getModelOptions = {
    method: 'GET',
    uri: `${api}/twiglets/${name}/model`,
    transform(body) {
      return JSON.parse(body);
    },
  };
  return rp(getModelOptions)
  .then((model) => {
    const putModelOptions = {
      method: 'PUT',
      uri: `${api}/twiglets/${name}/model`,
      body: {
        _rev: model._rev, // eslint-disable-line
        entities: twigletModel.entities,
      },
      json: true,
      jar: true,
    };
    return rp(putModelOptions);
  });
}

function putTwiglet(twiglet) {
  const getOptions = {
    method: 'GET',
    uri: `${api}/twiglets/${name}`,
    transform(body) {
      return JSON.parse(body);
    },
  };
  return rp(getOptions).then((response) => {
    const putOptions = {
      method: 'PUT',
      uri: `${api}/twiglets/${name}`,
      body: {
        _rev: response._rev, // eslint-disable-line
        commitMessage: twiglet.snapshotName,
        description: response.description,
        doReplacement: true,
        links: twiglet.links,
        name: response.name,
        nodes: twiglet.nodes,
      },
      json: true,
      jar: true,
    };
    return rp(putOptions);
  });
}

function updateTwiglet(twiglet) {
  return putTwigletModel(twiglet.model)
  .then(() => putTwiglet(twiglet));
}

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

function initializeTwiglet(snapshotName, snapshotDescription) {
  return {
    snapshotName,
    snapshotDescription,
    nodes: [],
    links: [],
  };
}

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

const classKeys = {
  members: 'users',
  activeMembers: 'user',
  inactiveMembers: 'user-o',
  messages: 'commenting',
  group: 'comments',
};

function createAndReturnEntity(model, className, color, size) {
  const entityName = `${className}_${color}_${size}`;
  if (!model.entities[entityName]) {
    Object.assign(model.entities, {
      [entityName]: {
        class: className,
        color,
        size,
        type: entityName,
        image: icons[className],
      },
    });
  }
  return entityName;
}

function createNodesAndLinks(twiglet, model, channel, scaleFunctions) {
  const type = channel.type === 'group' ? 'comments' : 'comments-o';
  const channelNode = {
    name: channel.name,
    id: channel.id,
    type: createAndReturnEntity(model, type, '#000000', 40),
    attrs: [],
  };
  twiglet.nodes.push(channelNode);
  const nodeKeys = ['members', 'activeMembers', 'inactiveMembers', 'messages'];
  nodeKeys.forEach((key) => {
    const size = Math.round(scaleFunctions[key](channel[key]));
    const keyNode = {
      name: `${key} - ${channel[key]}`,
      id: `${channel.id}-${key}`,
      type: createAndReturnEntity(model, classKeys[key], getColor(channel, key), size),
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
  const model = {
    entities: {
    },
  };
  let users = {};
  let channels = {};
  const now = moment(new Date()).utc();
  const timeIntervalAgo = now.subtract(interval, 'second').unix();

  return Slack.users.list({ token, presence: true })
  .then((usersResults) => {
    users = usersResults.members.reduce((object, member) =>
      Object.assign(object, { [member.id]: member }), {});
    return Slack.channels.list({ token });
  })
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
  .then((messages) => {
    messages.forEach((message) => {
      channels[message.name].messages = message.messages.length;
    });
    return Slack.groups.list({ token });
  })
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
        createNodesAndLinks(twiglet, model, channels[channelName], scaleFunctions));
    twiglet.model = model;
    login()
    .then(() => updateTwiglet(twiglet))
    .then(() => putSnapshot(twiglet))
    .then(() => console.log('snapshot placed'))
    .catch(error => console.error('error!', error.error));
  })
  .catch((error) => {
    console.warn(error); // eslint-disable-line
  });
}

getSummary();

setInterval(getSummary, interval * 1000);

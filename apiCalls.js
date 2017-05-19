const rp = require('request-promise-native');
const { apiUrl, email, password, twigletName } = require('./config');

/**
 * Login and keep the cookie.
 *
 * @returns RequestPromise.
 */
function login() {
  const options = {
    method: 'POST',
    uri: `${apiUrl}/login`,
    body: {
      email,
      password,
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
    uri: `${apiUrl}/twiglets/${twigletName}`,
    transform(body) {
      return JSON.parse(body);
    },
  };
  return rp(getOptions).then((response) => {
    const putOptions = {
      method: 'PATCH',
      uri: response.url,
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
  const getOptions = {
    method: 'GET',
    uri: `${apiUrl}/twiglets/${twigletName}`,
    transform(body) {
      return JSON.parse(body);
    },
  };
  return rp(getOptions).then((response) => {
    const postOptions = {
      method: 'POST',
      uri: response.events_url,
      body: {
        name: eventName,
      },
      json: true,
      jar: true,
    };
    return rp(postOptions);
  });
}

module.exports = {
  login,
  patchTwiglet,
  createEvent,
};

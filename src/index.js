'use strict';
const Alexa = require('alexa-sdk');

const handlers = {
    'LaunchRequest': function() {
        this.emit(':ask', this.t('WELCOME_MESSAGE'), this.t('WELCOME_MESSAGE_RETRY'));
    },
    'CommandIntent': function () {
      const o_garadgetAccount = new GaradgetAccount(this, 'command');
      o_garadgetAccount.f_setStatusValidated(function(a_devices) {
        o_garadgetAccount.f_reportResults();
      });
    },
    'StatusIntent': function() {
      const o_garadgetAccount = new GaradgetAccount(this, 'status');
      o_garadgetAccount.f_getStatusValidated(function(a_devices) {
        o_garadgetAccount.f_reportResults();
      });
    },
    'HistoryIntent': function() {
      const o_garadgetAccount = new GaradgetAccount(this, 'history');
      o_garadgetAccount.f_getStatusValidated(function(a_devices) {
        o_garadgetAccount.f_reportResults();
      });
    },
    'AMAZON.HelpIntent': function() {
        this.emit(':tell', this.t('HELP_MESSAGE'));
    },
    'AMAZON.StopIntent': function() {
        this.emit(':tell', this.t('STOP_MESSAGE'));
    },
    'AMAZON.CancelIntent': function() {
        this.emit(':tell', this.t('STOP_MESSAGE'));
    },
    'Unhandled': function() {
        this.emit('SessionEndedRequest');
    }
};

// --------------------------------------------------------------------------------
// Particle Account Class
// --------------------------------------------------------------------------------
function GaradgetAccount (o_alexa, s_intent) {
  this.s_token = o_alexa.event.session.user.accessToken;
  this.o_alexa = o_alexa;
  this.s_intent = s_intent;
  this.n_productId = 355;
  this.s_hostname = 'api.particle.io';
  this.a_devices = null;
}

GaradgetAccount.prototype.f_request = function(a_options, f_callback) {
  var o_https = require('https');
  var s_response = '';
  a_options.hostname = this.s_hostname;

  var o_request = o_https.request(a_options, function(o_response) {
    o_response.on('data', function (s_chunk) {
        s_response += s_chunk;
    });
    o_response.on('end', function () {
      if (o_response.statusCode == 401)
        return f_callback('ERROR_UNAUTHORIZED');

      var a_response = JSON.parse(s_response);
      if (a_response.error) {
        console.log("ERROR: " + a_response.error_description);
        return f_callback(a_response.error_description);
      }
      f_callback(null, a_response);
    });
    o_response.on('error', (o_error) => {
        console.log(`Got error: ${o_error.message}`);
        return f_callback(o_error);
    });
  });
  if (a_options.body)
    o_request.write(a_options.body);
  o_request.end();
};

GaradgetAccount.prototype.f_load = function (f_callback) {
  var a_options = {
      path: '/v1/devices?access_token=' + this.s_token,
      method: 'GET'
  };
  this.f_request(a_options, function(s_error, a_response) {
    if (s_error)
      return f_callback(s_error);
    return f_callback(null, a_response);
  });
};

GaradgetAccount.prototype.f_select = function (s_name, f_callback) {
  var o_this = this;
  this.a_selectedDevices = [];

  this.f_load(function(s_error, a_response) {
    if (s_error)
      return f_callback(s_error);

    // get list of garadget devices
    o_this.a_devices = [];
    for (var n_device = 0; n_device < a_response.length; n_device++) {
      if (a_response[n_device].product_id != o_this.n_productId)
        continue;
      o_this.a_devices.push(new GaradgetDevice(a_response[n_device], o_this));
    }
    if (!o_this.a_devices.length)
      return f_callback('ERROR_NO_DOORS');

    // single device account
    if (o_this.a_devices.length == 1) {
      console.log("GetByName: Single");
      o_this.a_selectedDevices = o_this.a_devices;
      return f_callback();
    }

    // sort multiple doors by name
    o_this.a_devices.sort(function(o_device1, o_device2) {
      var s_name1 = o_device1.s_name.toLowerCase();
      var s_name2 = o_device2.s_name.toLowerCase();
      if (s_name1 < s_name2)
        return -1;
      if (s_name1 > s_name2)
        return 1;
      return 0;
    });

    // return all doors
    if (typeof s_name === 'undefined' || s_name === '' || s_name == 'all') {
      console.log("GetByName: All");
      o_this.a_selectedDevices = o_this.a_devices;
      return f_callback();
    }

    // find match by name
    var n_bestMatchPos = -1, n_bestMatchCount = 0, n_wordInput, n_wordDoor;
    var a_wordsInput = s_name.split(' ');
    for (n_device = 0; n_device < o_this.a_devices.length; n_device++) {
      // return exact match
      if (o_this.a_devices[n_device].s_name == s_name) {
        console.log("GetByName: Exact");
        o_this.a_selectedDevices.push(o_this.a_devices[n_device]);
        return f_callback();
      }
      // find best partial match
      var a_wordsDoor = o_this.a_devices[n_device].s_name.split(' ');
      var n_matchCount = 0;
      for (n_wordDoor = 0; n_wordDoor < a_wordsDoor.length; n_wordDoor++)
        for (n_wordInput = 0; n_wordInput < a_wordsInput.length; n_wordInput++)
          if (a_wordsDoor[n_wordDoor] == a_wordsInput[n_wordInput])
            n_matchCount++;
      if (n_matchCount > n_bestMatchCount) {
        n_bestMatchCount = n_matchCount;
        n_bestMatchPos = n_device;
      }
    }

    // return best partial match
    if (n_bestMatchCount) {
      console.log("GetByName: Partial");
      o_this.a_selectedDevices.push(o_this.a_devices[n_bestMatchPos]);
      return f_callback();
    }

    // return by the numeric position
    if (!isNaN(s_name)) {
      if (s_name > o_this.a_devices.length)
        return f_callback('ERROR_BAD_NUMBER');
      console.log("GetByName: Numeric");
      o_this.a_selectedDevices.push(o_this.a_devices[parseInt(s_name) - 1]);
      return f_callback();
    }
    return f_callback('ERROR_NOT_FOUND');
  });
};

GaradgetAccount.prototype.f_selectValidated = function (f_callback) {
  const s_receivedName = this.o_alexa.event.request.intent.slots.name.value;
  var o_this = this;

  // get matching doors
  this.f_select(
    s_receivedName,
    function(s_error) {

      var a_device, n_device;
      if (s_error) {
        console.log('ERROR: ' + s_error);
        switch (s_error) {
          case 'ERROR_UNAUTHORIZED':
            return o_this.o_alexa.emit(':tellWithLinkAccountCard', o_this.o_alexa.t('ERROR_UNAUTHORIZED'));

          case 'ERROR_NOT_FOUND':
            var a_names = [];
            for (n_device = 0; n_device < o_this.a_devices.length; n_device++)
              a_names.push("'" + o_this.a_devices[n_device].s_name + "'");
            return o_this.o_alexa.emit(':tell', o_this.o_alexa.t(s_error, s_receivedName, a_names.join(' ')));

          case 'ERROR_BAD_NUMBER':
            return o_this.o_alexa.emit(':tell', o_this.o_alexa.t(s_error, s_receivedName, o_this.a_devices.length));

          default:
            return o_this.o_alexa.emit(':tell', o_this.o_alexa.t(s_error, s_receivedName));
        }
      }
      f_callback();
    }
  );
};

GaradgetAccount.prototype.f_setStatusValidated = function(f_callback) {
  var o_this = this;
  var a_slots = o_this.o_alexa.event.request.intent.slots;
  if (!a_slots.command)
    return o_this.o_alexa.emit(':tell', o_this.o_alexa.t('ERROR_NO_COMMAND'));
  const s_receivedState = a_slots.command.value;

  // validate state
  var s_command;
  if (s_receivedState == o_this.o_alexa.t('COMMAND_OPEN'))
    s_command = 'open';
  else if (s_receivedState == o_this.o_alexa.t('COMMAND_CLOSE'))
    s_command = 'close';
  else if (s_receivedState == o_this.o_alexa.t('COMMAND_STOP'))
    s_command = 'stop';
  else
    return o_this.o_alexa.emit(':tell', this.t('ERROR_BAD_COMMAND', s_receivedState));

  this.f_selectValidated(function() {

    o_this.n_pendingRequests = o_this.a_selectedDevices.length;
    var f_onComplete = function () {
      o_this.n_pendingRequests--;
      if (!o_this.n_pendingRequests)
        f_callback(o_this.a_selectedDevices);
    };

    for (var n_device = 0; n_device < o_this.a_selectedDevices.length; n_device++) {
      var o_device = o_this.a_selectedDevices[n_device];
      o_device.f_setStatusValidated(s_command, f_onComplete);
    }
  });
};

GaradgetAccount.prototype.f_getStatusValidated = function(f_callback) {
  var o_this = this;
  this.f_selectValidated(function() {
    o_this.n_pendingRequests = o_this.a_selectedDevices.length;
    var f_onComplete = function () {
      o_this.n_pendingRequests--;
      if (!o_this.n_pendingRequests)
        f_callback(o_this.a_selectedDevices);
    };
    for (var n_device = 0; n_device < o_this.a_selectedDevices.length; n_device++) {
      var o_device = o_this.a_selectedDevices[n_device];
      o_device.s_result = o_this.s_intent;
      o_device.f_loadStatus(f_onComplete);
    }
  });
};

GaradgetAccount.prototype.f_reportResults = function() {

  // single door reporting
  if (this.a_devices.length == 1)
    return this.o_alexa.emit(':tell', this.a_selectedDevices[0].f_getStatusResponse('SINGLE'));
  if (this.a_selectedDevices.length == 1)
    return this.o_alexa.emit(':tell', this.a_selectedDevices[0].f_getStatusResponse('ONE'));

  // count different statuses
  var n_device, a_device, s_status, a_statusList = [], a_statusIndex = {};
  for (n_device = 0; n_device < this.a_selectedDevices.length; n_device++) {
    a_device = this.a_selectedDevices[n_device];
    s_status = a_device.s_status;
    if (a_statusIndex[s_status]) {
      a_statusIndex[s_status].push(a_device);
    }
    else {
      a_statusIndex[s_status] = [a_device];
      a_statusList.push(s_status);
    }
  }

  // all doors in the same status
  if (a_statusList.length == 1)
    return this.o_alexa.emit(':tell', this.a_selectedDevices[0].f_getStatusResponse('ALL'));

  // report individual statuses of each door
  var a_messages = [];
  for (n_device = 0; n_device < this.a_selectedDevices.length; n_device++) {
    a_device = this.a_selectedDevices[n_device];
    a_messages.push(this.o_alexa.t(a_device.f_getStatusResponse('ONE')));
  }
  this.o_alexa.emit(':tell', a_messages.join(' '));

  // @todo: report as "door1, door2 and door3 are closed, door4 is open"
/*  for (var n_status = 0; n_status < a_statusList.length; n_status++) {
    var a_deviceList = a_statusIndex[a_statusList[n_status]];
  }*/
};

// --------------------------------------------------------------------------------
// Particle Device Class
// --------------------------------------------------------------------------------
function GaradgetDevice (a_data, o_account) {
  this.n_id = a_data.id;
  this.s_name = a_data.name.replace(/\_/, ' ').toLowerCase();
  this.b_online = a_data.connected;
  this.n_lastHeard = Date.parse(a_data.last_heard);
  this.o_account = o_account;
  this.s_status = null;
  this.s_error = null;
}

GaradgetDevice.prototype.f_loadStatus = function(f_callback) {

  if (!this.b_online) {
    this.s_status = 'offline';
    return f_callback();
  }

  var a_options = {
    path: '/v1/devices/' + this.n_id + '/doorStatus?access_token=' + this.o_account.s_token,
    method: 'GET'
  };
  const o_this = this;
  this.a_variables = {};
  this.o_account.f_request(a_options, function(s_error, a_response) {
    if (s_error) {
      o_this.s_error = s_error;
      o_this.s_status = 'error';
    }
    else if (a_response.error || !a_response.result) {
      o_this.s_error = a_response.error;
      o_this.s_status = 'error';
    }
    else {
      var a_values = a_response.result.split('|');
      for (var n_variable = 0; n_variable < a_values.length; n_variable++) {
        var a_matches = a_values[n_variable].match(/^(\w+)=(.+)$/);
        if (!a_matches)
          continue;
        o_this.a_variables[a_matches[1].toLowerCase()] = a_matches[2];
      }
      if (!o_this.a_variables.status){
        o_this.s_error = 'Status not found';
        o_this.s_status = 'error';
      }
      else {
        o_this.s_status = o_this.a_variables.status;
      }
    }
    return f_callback();
  });
};

GaradgetDevice.prototype.f_saveStatus = function(s_command, f_callback) {

  var a_options = {
      path: '/v1/devices/' + this.n_id + '/setState',
      method: 'POST',
      headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: 'access_token=' + this.o_account.s_token + '&arg=' + encodeURIComponent(s_command)
  };
  this.o_account.f_request(a_options, f_callback);
};

GaradgetDevice.prototype.f_setStatusValidated = function(s_command, f_callback) {

  var o_this = this;
  this.f_loadStatus(function() {
    switch (o_this.s_status) {
      case 'error':
      case 'offline':
        o_this.s_result = 'error';
        return f_callback();
    }
    var s_transition = s_command + '-' + o_this.a_variables.status;
    switch (s_transition) {
      case 'open-open':
      case 'open-opening':
      case 'close-closed':
      case 'close-closing':
        o_this.s_result = 'skip-move';
        return f_callback();
      case 'stop-stopped':
      case 'stop-open':
      case 'stop-closed':
        o_this.s_result = 'skip-stop';
        return f_callback();
    }
    o_this.f_saveStatus(s_command, function(s_error) {
      if (s_error) {
        this.s_status = 'error';
        this.s_error = s_error;
        o_this.s_result = 'error';
        return f_callback();
      }
      o_this.s_result = 'done';
      switch(s_command) {
        case('open'):
          o_this.s_status = 'opening';
          break;
        case('close'):
          o_this.s_status = 'closing';
          break;
        case('stop'):
          o_this.s_status = 'stopping';
          break;
      }
      return f_callback();
    });
  });
};

GaradgetDevice.prototype.f_getStatusResponse = function(s_type) {
  var s_response = String(s_type + '_' + this.s_status).toUpperCase();
  var s_yesNo = '';
  var s_time = null;

  switch (this.s_result) {
    case 'done':
      s_response = 'CONFIRM_' + s_type + '_' + this.s_status;
      break;
    case 'skip-move':
      s_response = 'STATUS_ALREADY_' + this.s_status;
      break;
    case 'skip-stop':
      s_response = 'STATUS_ALREADY_STOPPED';
      break;
    case 'history':
      s_time = this.f_getTimeResponse();
      s_response = 'HISTORY_' + this.s_status;
      break;
    default:
      if (s_type == 'SINGLE') {
        s_yesNo = this.f_stateMatchResponse() + ', ';
        s_type = 'ONE';
      }
      s_response = 'REPORT_' + s_type + '_' + this.s_status;
      break;
  }
  return s_yesNo + this.o_account.o_alexa.t(s_response.toUpperCase(), this.s_name, s_time);
};

GaradgetDevice.prototype.f_stateMatchResponse = function() {

  var a_slots = this.o_account.o_alexa.event.request.intent.slots;
  if (!a_slots.state)
    return '';
  const s_receivedStatus = a_slots.state.value;

  var s_status;
  var o_alexa = this.o_account.o_alexa;
  if (s_receivedStatus == o_alexa.t('STATUS_CLOSED'))
    s_status = 'closed';
  else if (s_receivedStatus == o_alexa.t('STATUS_OPEN'))
    s_status = 'open';
  else if (s_receivedStatus == o_alexa.t('STATUS_OFFLINE'))
    s_status = 'offline';
  else if (s_receivedStatus == o_alexa.t('STATUS_STOPPED'))
    s_status = 'stopped';
  else if (s_receivedStatus == o_alexa.t('STATUS_CLOSING'))
    s_status = 'closing';
  else if (s_receivedStatus == o_alexa.t('STATUS_OPENING'))
    s_status = 'opening';
  else
    return '';

  return o_alexa.t(this.s_status == s_status ? 'WORD_YES' : 'WORD_NO');
};

GaradgetDevice.prototype.f_getTimeResponse = function() {
  var s_time;
  if (this.s_status == 'offline') {
    var n_now = (new Date()).getTime();
    var n_timeOffline = Math.ceil((n_now - this.n_lastHeard) / 1000);
    var s_units = 'S';
    if (n_timeOffline >= 120) {
      n_timeOffline = Math.ceil(n_timeOffline / 60);
      s_units = 'M';
    }
    if (n_timeOffline >= 120) {
      n_timeOffline = Math.ceil(n_timeOffline / 60);
      s_units = 'H';
    }
    if (n_timeOffline >= 48) {
      n_timeOffline = Math.ceil(n_timeOffline / 24);
      s_units = 'D';
    }
    s_time = n_timeOffline + s_units;
  }
  else {
    s_time = this.a_variables.time.toUpperCase();
  }

  var a_matches = s_time.match(/^(\d+)(\w)$/);
  var o_alexa = this.o_account.o_alexa;
  if (!a_matches)
    return o_alexa.t('ERROR_UNKNOWN_TIME');

  return a_matches[1] + ' ' + o_alexa.t('TIME_' + a_matches[2]);
};

const a_languageStrings = {
    'en-US': {
        translation: {
            SKILL_NAME: 'Garadget Voice Control',
            WELCOME_MESSAGE: 'Welcome to Garadget skill - voice control for your garage doors. You can tell Garadget to open or close doors or ask Garadget about their status ... Let\'s give it a try!',
            WELCOME_MESSAGE_RETRY: 'You can say things like: close all doors, or what is the status of door one.',
            HELP_MESSAGE: 'This skill allows you to control and monitor your Garadget-equipped garage doors. You can tell Garadget to open or close doors and ask about the status or recent events. If there are multiple doors in the account, they can be identified by name or number. You can say things like, Alexa, tell Garadget to close door \'Home\' ... or Alexa, ask Garadget about status of door One.',
            STOP_MESSAGE: 'Thanks for using Garadget, Goodbye!',

            WORD_YES: 'yes',
            WORD_NO: 'no',
            WORD_AND: 'and',

            COMMAND_OPEN: 'open',
            COMMAND_CLOSE: 'close',
            COMMAND_STOP: 'stop',

            STATUS_OPEN: 'open',
            STATUS_OPENING: 'opening',
            STATUS_CLOSED: 'closed',
            STATUS_CLOSING: 'closing',
            STATUS_STOPPED: 'stopped',
            STATUS_OFFLINE: 'offline',

            STATUS_ALREADY_OPEN: 'The door \'%s\' was already open.',
            STATUS_ALREADY_OPENING: 'The door \'%s\' was already opening.',
            STATUS_ALREADY_CLOSED: 'The door \'%s\' was already closed.',
            STATUS_ALREADY_CLOSING: 'The door \'%s\' was already closing.',
            STATUS_ALREADY_STOPPED: 'The door \'%s\' was not moving.',

            CONFIRM_ALL_OPENING: 'Opening all garage doors.',
            CONFIRM_ALL_CLOSING: 'Closing all garage doors.',
            CONFIRM_ALL_STOPPING: 'Stopping all garage doors.',
            CONFIRM_SINGLE_OPENING: 'Opening.',
            CONFIRM_SINGLE_CLOSING: 'Closing.',
            CONFIRM_SINGLE_STOPPING: 'Stopping.',
            CONFIRM_ONE_OPENING: 'Opening %s.',
            CONFIRM_ONE_CLOSING: 'Closing %s.',
            CONFIRM_ONE_STOPPING: 'Stopping %s.',

            REPORT_ONE_OPEN: '\'%s\' is open.',
            REPORT_ONE_OPENING: '\'%s\' is opening.',
            REPORT_ONE_CLOSED: '\'%s\' is closed.',
            REPORT_ONE_CLOSING: '\'%s\' is closing.',
            REPORT_ONE_STOPPED: '\'%s\' is stopped.',
            REPORT_ONE_OFFLINE: '\'%s\' is currently offline.',
            REPORT_ONE_ERROR: '\'%s\' did not respond.',

            REPORT_ALL_OPEN: 'All doors are open.',
            REPORT_ALL_OPENING: 'All doors are opening.',
            REPORT_ALL_CLOSED: 'All doors are closed.',
            REPORT_ALL_CLOSING: 'All doors are closing.',
            REPORT_ALL_STOPPED: 'All doors are stopped.',
            REPORT_ALL_OFFLINE: 'All doors are offline.',
            REPORT_ALL_ERROR: 'Doors did not respond.',

            HISTORY_OPEN: '\'%s\' has been open for %s.',
            HISTORY_OPENING:'\'%s\' has been opening for %s.',
            HISTORY_CLOSED:'\'%s\' has been closed for %s.',
            HISTORY_CLOSING:'\'%s\' has been closing for %s.',
            HISTORY_STOPPED:'\'%s\' has been stopped for %s.',
            HISTORY_OFFLINE:'\'%s\' has been offline for %s.',
            HISTORY_ERROR: '\'%s\' did not respond.',

            TIME_S: 'seconds',
            TIME_M: 'minutes',
            TIME_H: 'hours',
            TIME_D: 'days',

            CARD_TITLE_COMMAND: "Garadget Command",
            CARD_TITLE_STATUS: "Garadget Status",
            CARD_TITLE_HISTORY: "Garadget History",

            ERROR_NO_COMMAND: 'Please give a command such as \'open\', \'close\' or \'stop\'.',
            ERROR_BAD_COMMAND: '\'%s\' is not a valid command. Available commands are: open, close and stop.',
            ERROR_NO_DOORS: 'I couldn\'t find any doors in your account. Please use mobile app to add Garadget controllers.',
            ERROR_UNAUTHORIZED: 'You must have a Garadget account to use this skill. Please use the Alexa app to link your Amazon account with your Garadget Account.',
            ERROR_BAD_NUMBER: 'There is no door number %s in your account. Currently available numberic choices are 1 through %u.',
            ERROR_NOT_FOUND: 'There is no door \'%s\' in your account. Available choices are: %s.',
            ERROR_PARTICLE: 'There was error wile talking to Particle server. Please try again later.',
            ERROR_UNKNOWN_TIME: 'Unknown Time'
        },
    }
};

exports.handler = (event, context) => {
    const o_alexa = Alexa.handler(event, context);
    o_alexa.appId = process.env.appId;
    o_alexa.resources = a_languageStrings;
    o_alexa.registerHandlers(handlers);
    o_alexa.execute();
};

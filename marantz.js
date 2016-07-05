var util          = require("util");
var EventEmitter  = require("events").EventEmitter;

var serialport = require('serialport');
var SerialPort = serialport.SerialPort;


var PROPERTY_SOURCE = "SI";
var PROPERTY_VOLUME = "MV";
var PROPERTY_MUTE   = "MU";

// minimum amount of time between sending commands to the marantz (otherwise they're queued)
var MIN_COMMAND_DELAY = 200; 

// Volume levels on the Marantz are very annoying.

var MAX_VOLUME = 800;
var MIN_VOLUME = 0;

var DEFAULT_VOLUME_RAW = 525;


var Marantz = function(config) {
  EventEmitter.call(Marantz);

  this.serialPortName = (config && config.hasOwnProperty("port")) ? config.port : "/dev/ttyAMA0";

  this.DEBUG = (config && config.hasOwnProperty("debug")) ? config.debug : false;

  this.source  = "DVD";
  this.volume  = 400;
  this.mute    = false;

  this.asyncCallbackQueue = [];
  this.commandQueue = [];

  this.lastCommandDispatchTime = 0;
  this.delayedCommandPending = false;

  if(!this.DEBUG){
    this.serial = new SerialPort(this.serialPortName, {
      parser: serialport.parsers.readline('\r'),
      baudRate: 9600,
      autoOpen: false
    });

    this.serial.on('open', (err) => {
      console.log("Marantz: Serial port is open.");

      // Queue up commands to get the current settings for the unit.
      this._queueMarantzCommand("MV?");
      this._queueMarantzCommand("MU?");
      this._queueMarantzCommand("SI?");
    });

    this.serial.on("error", (err) => {
      console.log("Marantz: Serial port error", err);
    });

    this.serial.on('data', (data) => {
      this._handleMarantzOutput(data);   
    });
  } else {
    this._queueMarantzCommand("MV?");
    this._queueMarantzCommand("MU?");
    this._queueMarantzCommand("SI?");
  }

}
util.inherits(Marantz, EventEmitter);


Marantz.prototype._dispatchNextCommand = function() {
  var command = this.commandQueue.shift();
  
  this.lastCommandDispatchTime = new Date().getTime();

  //console.log("Sending Marantz command: " + command);

  this.delayedCommandPending = false;
  this._checkCommandQueue();


  // DEBUG - fake a response from the marantz after a random delay.
  if(this.DEBUG) {

    // turn up/down volume commands into volume levels.
    if(command === "MVUP") {
      command = "MV" + Math.max(MIN_VOLUME, this.volume + 5);
    } else if(command === "MVDOWN") {
      command = "MV" + Math.min(MAX_VOLUME, this.volume - 5);
    }

    if(command === "MV?"){
      command = "MV400";
    }
    if(command === "MU?"){
      command = "MUOFF";
    }
    if(command === "SI?"){
      command = "SIDVD";
    }

    setTimeout(() => {
      this._handleMarantzOutput(command);
    }, Math.floor(Math.random() * 200) + 100);
  } else {
    this.serial.write(command + "\r");
  }
}

Marantz.prototype._checkCommandQueue = function(){

  if(this.commandQueue.length > 0) {
    var millisSinceLastCommand = new Date().getTime() - this.lastCommandDispatchTime;
    
    if(millisSinceLastCommand > MIN_COMMAND_DELAY) {
      // It's been long enough, dipatch the command immediately.
      //console.log("No need to wait, dispatching immediately.");
      
      this._dispatchNextCommand();
    } else if (this.delayedCommandPending == false) {
      
      var millisToWait = Math.max(10, MIN_COMMAND_DELAY - millisSinceLastCommand);
      
      //console.log("Waiting " + millisToWait + " before next command.");

      this.delayedCommandPending = true;
      setTimeout(() => {
        this.delayedCommandPending = false;
        this._dispatchNextCommand();
      }, millisToWait);
    } else {
      // a command is already pending (the timeout is set) so 
      // do nothing, when the timer fires the queue will not be 
      // empty to this queued command will be dispatched later.
    }
  } else {
    //console.log("CheckCommandQueue: queue is empty...");
  }
}

Marantz.prototype._queueMarantzCommand = function(command) {
  this.commandQueue.push(command);
  this._checkCommandQueue();
}

Marantz.prototype._notifyCallbacks = function(prop) {
  this.asyncCallbackQueue = this.asyncCallbackQueue.filter( (item) => {
    if(item.property == prop) {
      try{
        item.callback(this.getState());
      } catch(ex){
        console.log("Marantz: exception while invoking property callback.");
      }
      return false;
    } else {
      return true;
    }
  });
}

Marantz.prototype._handleMarantzOutput = function(data) {
  
  console.log("Got Marantz data: " + data);

  if(data.indexOf(PROPERTY_SOURCE) === 0) {
    console.log("Source changed: " + data);
    var newSource = data.substring(2);
    this.source = newSource;
    this._notifyCallbacks(PROPERTY_SOURCE);
    this.emit("state", this.getState());
  }

  if(data.indexOf(PROPERTY_MUTE) === 0){
    console.log("Mute changed: " + data);
    var muteState = data.substring(2);
    this.mute = (muteState == "ON");
    this._notifyCallbacks(PROPERTY_MUTE);
    this.emit("state", this.getState());
  }

  if((data.indexOf(PROPERTY_VOLUME) === 0) && (data.indexOf("MVMAX") === -1)) {
    
    var volumeLevel = data.substring(2);

    // if it's only 2 digits, add the trailing zero.
    if(volumeLevel.length == 2) {
      volumeLevel = volumeLevel + "0";
    }

    this.volume = parseInt(volumeLevel, 10);
    console.log("Volume changed to: " + this.volume);
    
    
    this._notifyCallbacks(PROPERTY_VOLUME);
    this.emit("state", this.getState());
  }
}


Marantz.prototype._registerAsyncCallback = function(prop, _callback) {
  if(_callback && typeof(_callback) === "function") {
    this.asyncCallbackQueue.push({
      property: prop,
      callback: _callback
    });
  }
}

/*
*/
Marantz.prototype._setVolumeRaw = function(rawVolume) {
  
  if(isNaN(parseInt(rawVolume, 10))) {
    return;
  }

  var volumeLevel = parseInt(rawVolume, 10);

  // make sure it's a multiple of 5, this might not be needed but who knows..
  if(volumeLevel % 5 !== 0){
    volumeLevel -= (volumeLevel % 5);
  }

  volumeLevel = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, volumeLevel));

  volumeLevel *= 0.1;

  // get the dumb 5's on the end..
  var stringValue = volumeLevel + "";
  stringValue = stringValue.replace(".", "");
  
  if(rawVolume < 100) {
    stringValue = "0" + stringValue;
  }

  this._queueMarantzCommand("MV" + stringValue);
}


// Public Methods //


Marantz.prototype.getNormalizedVolume = function(raw_value) {
  var result = (raw_value - MIN_VOLUME) / (MAX_VOLUME - MIN_VOLUME);
  return Math.min(1, Math.max(0, result));
}


Marantz.prototype.setInput = function(input, _callback) {
  this._registerAsyncCallback(PROPERTY_SOURCE, _callback);
  this._queueMarantzCommand("SI" + input);
}


Marantz.prototype.setMute = function(mute, _callback) {
  this._registerAsyncCallback(PROPERTY_MUTE, _callback);
  var muteParam = (mute) ? "ON" : "OFF";
  this._queueMarantzCommand("MU" + muteParam);
}


Marantz.prototype.getDefaultVolume = function() {
  return this.getNormalizedVolume(DEFAULT_VOLUME_RAW);
};

Marantz.prototype.setVolume = function(volume, _callback) {
  // lerp into the crazy Marantz value range.
  var scaledVolume = (volume * (MAX_VOLUME - MIN_VOLUME)) + MIN_VOLUME;
  this._registerAsyncCallback(PROPERTY_VOLUME, _callback);
  this._setVolumeRaw(scaledVolume);
}



Marantz.prototype.volumeUp = function(_callback) {
  if(this.volume > MIN_VOLUME){
    this._registerAsyncCallback(PROPERTY_VOLUME, _callback);
    this._queueMarantzCommand("MVUP");
  } else {
    if(typeof(_callback) === "function"){
      _callback(this.getState());
    }
  }
}

Marantz.prototype.volumeDown = function(_callback) {
  if(this.volume < MAX_VOLUME) {
    this._registerAsyncCallback(PROPERTY_VOLUME, _callback);
    this._queueMarantzCommand("MVDOWN", _callback);
  } else {
    if(typeof(_callback) === "function"){
      _callback(this.getState());
    }
  }
}

Marantz.prototype.getState = function() {
  return {
    "input" : this.source,
    "volume" : this.getNormalizedVolume(this.volume),
    "mute" : this.mute
  };
}


module.exports = Marantz;
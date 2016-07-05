var util          = require("util");
var EventEmitter  = require("events").EventEmitter;
var net = require('net');


var packet_getPowerStatus = Buffer.from([
  0xBE, 0xEF, 0x03, 0x06, 0x00, // header
  0x19, 0xD3,                   // crc flags
  0x02, 0x00,                   // action (get)
  0x00, 0x60,                   // type (power)
  0x00, 0x00                    // settings (not used)
]);

var packet_setPowerOn = Buffer.from([
  0xBE, 0xEF, 0x03, 0x06, 0x00, // header
  0xBA, 0xD2,                   // crc flags
  0x01, 0x00,                   // action (set)
  0x00, 0x60,                   // type (power)
  0x01, 0x00                    // settings 
]);

var packet_setPowerOff = Buffer.from([
  0xBE, 0xEF, 0x03, 0x06, 0x00, // header
  0x2A, 0xD3,                   // crc flags
  0x01, 0x00,                   // action (set)
  0x00, 0x60,                   // type (power)
  0x00, 0x00                    // settings
]);


var Christie = function(config) {
  EventEmitter.call(Christie);

  this.address = (config && config.hasOwnProperty("address")) ? config.address : "0.0.0.0";
  this.port = (config && config.hasOwnProperty("port")) ? config.port : 23;

  this.lastPowerStatus = "unknown";

  this.commandQueue = [];
  this.commandId = 1;
  this.commandPending = false;
  this.activeCommand = null;

  this.client = null;
};

util.inherits(Christie, EventEmitter);


Christie.prototype.updatePowerStatus = function(_callback) {
  this.sendCommand(makeGetStatusCommand(), _callback);
};


Christie.prototype.turnPowerOn = function(_callback) {
  this.sendCommand(makePowerOnCommand(), _callback);
  this.updatePowerStatus();
};

Christie.prototype.turnPowerOff = function(_callback) {
  this.sendCommand(makePowerOffCommand(), _callback);
  this.updatePowerStatus();
};


Christie.prototype.dispatchCommands = function(){
  if((this.commandQueue.length > 0) && (!this.commandPending)) {
    
    // connect if not already connected.
    if(this.client == null) {
      this.client = new net.Socket();
      
      this.client.on("data", (data) => {
        this.handleData(data);
      });

      this.client.on('close', () => {
        this.client = null;
        console.log('Connection closed');
      });

      this.client.on('error', (err) => {
        console.log("Socket error:", err);
        this.client = null;
      });

      this.client.connect(this.port, this.address, () => {
        console.log("Socket connected!");
        this.clientConnected();
      });

      return;
    }

    this.activeCommand = this.commandQueue.shift();
    this.commandPending = true;
    
    this.client.write(this.activeCommand.command.packet);
  }
}


Christie.prototype.handleData = function(data){

  switch(data[0]) {
    case 0x06: // ACK
      var response = this.activeCommand.command.handler.call(this, true);
      if(this.activeCommand.callback){
        this.activeCommand.callback(response);
      }
      console.log("Ack.");
    break;

    case 0x15: // NAK
      var response = this.activeCommand.command.handler.call(this, false);
      if(this.activeCommand.callback){
        this.activeCommand.callback(response);
      }
      console.log("Nak!");
    break;

    case 0x1C: // Error

      if(data.length !== 3){
        console.log("ERROR: Unexpected response length received for error: " + data.length + "bytes", data);
        return;
      }

      console.log("Error:", data);
    break;

    case 0x1D: // Data

      if(data.length !== 3){
        console.log("ERROR: Unexpected response length received for data: " + data.length + "bytes", data);
        return;
      } else {
        var response = this.activeCommand.command.handler.call(this, data[1], data[2]);
        if(this.activeCommand.callback) {
          this.activeCommand.callback(response);
        }
      }
    break;

    case 0x1F: // Auth error
    break;

    default:
      console.log("Unknown response type: ", data);
    break;
  }

  this.commandPending = false;

  if(this.commandQueue.length > 0) {
    this.dispatchCommands();
  }
}

Christie.prototype.clientConnected = function() {
  // Socket connected, start running commands if needed.
  if(this.commandQueue.length > 0) {
    this.dispatchCommands();
  }
}

Christie.prototype.sendCommand = function(command, _callback) {
  this.commandQueue.push({
    "id" : this.commandId++,
    "command" : command,
    "callback" : _callback
  });

  this.dispatchCommands();
}

Christie.prototype.getState = function() {
  return {
    "power": this.currentPowerState
  };
}

function makeGetStatusCommand() {
  return {
    "packet" : packet_getPowerStatus,
    "handler" : function(byte1, byte2) {
      var powerState = "unknown";
      switch(byte1) {
        case 0x00:
          powerState = "off";
          break;
        case 0x01:
          powerState = "on";
          break;
        case 0x02:
          powerState = "cooldown";
          break;
      }

      if(this.currentPowerState != powerState){
        this.currentPowerState = powerState;
        this.emit("change", this.getState() );
      }

      return powerState;
    }
  };
}


function makePowerOnCommand() {
  return {
    "packet" : packet_setPowerOn,
    "handler" : function(ok) {
      console.log("Power On: " + ok);
      return ok;
    }
  };
}


function makePowerOffCommand() {
  return {
    "packet" : packet_setPowerOff,
    "handler" : function(ok) {
      console.log("Power Off: " + ok);
      return ok;
    }
  };
}

module.exports = Christie;
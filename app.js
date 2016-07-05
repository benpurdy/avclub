var express   = require('express');
var app       = express();
var server    = require("http").createServer(app);
var Marantz = require('./marantz');
var Christie = require('./christie');


var connectedClients = 0;
var io = require('socket.io')(server);

var marantz = new Marantz({
  port: "/dev/ttyAMA0",
  debug: false
});


var christie = new Christie({
  address: "192.168.11.222"
});



function checkProjectorState() {
  if(connectedClients > 0) {
    console.log(connectedClients + " client(s) connected, checking projector status...");
    christie.updatePowerStatus();
  }
}

var projectorCheckInterval = setInterval(checkProjectorState, 10000);



io.sockets.on('connection', function (socket) {
  
  // if nobody was connected before, the projector state may be stale.
  if(connectedClients == 0) {
    christie.updatePowerStatus();
  }

  connectedClients++;
  socket.on("disconnect", function(){
    connectedClients--;
  });

  // christie.updatePowerStatus();

  socket.on("source", (data) => {
    marantz.setInput(data, function(state) {
      console.log("source updated: " + state.input);
    });
  });

  socket.on("mute", () => {
    var muted = marantz.getState().mute;

    marantz.setMute(!muted, function(newState) {
      console.log("mute updated: " + newState.mute);
    });
  });

  socket.on("volume-default", () => {
    marantz.setVolume( 0.65, function(newState) {
      console.log("volume update: " + newState.volume);
    });
  });

  socket.on("volume-up", () => {
    marantz.volumeUp(function(newState){
      console.log("volume update: " + newState.volume);
    });
  });

  socket.on("volume-down", () => {
    marantz.volumeDown(function(newState){
      console.log("volume update: " + newState.volume);
    });
  });

  socket.on("projector-on", () => {
    christie.turnPowerOn(function(ok) {
      console.log("Powering projector on.");
    });
  });

  socket.on("projector-off", () => {
    christie.turnPowerOff(function(ok) {
      console.log("Powering projector off.");
    });
  });

  socket.emit("state", marantz.getState());
  socket.emit("projector-state", christie.getState());
});


marantz.on("state", function(newState){
  io.emit("state", newState);
})


christie.on("change", function(newState) {
  console.log("projector state changed: ", newState);
  io.emit("projector-state", newState);
});

app.get("/cache.manifest", (req, res) => {
  res.header("Content-Type", 'text/cache-manifest');
  res.sendfile('public/cache.manifest');
});

app.use(express.static('public'));

//http.createServer(app).listen(3000);
server.listen(3000);

console.log("\n\n");
console.log("Server Started");

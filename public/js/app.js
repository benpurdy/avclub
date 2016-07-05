$(function() {

  var connectionProblemsTimeout = null;

  var hideOverlay = function() {
    $("#modal-overlay").fadeOut();
  }

  var showConnectionProlbemText = function() {
    $("#connecting").hide();
    $("#disconnected").show();
  }

  var showDisconnectOverlay = function() {
    $("#modal-overlay DIV").hide();
    $("#connecting").show();
    $("#modal-overlay").fadeIn();

    if(connectionProblemsTimeout !== null){
      window.clearTimeout(connectionProblemsTimeout);
      connectionProblemsTimeout = null;
    }

    connectionProblemsTimeout = window.setTimeout(showConnectionProlbemText, 5000);
  }

  var $sourceButtons = $("#sources").find(".button");
  var $audioButtons = $("#audio-levels").find(".button");
  var socket = io();
  
  socket.on("connect", function() {
    hideOverlay();
  });

  socket.on("disconnect", function() {
    showDisconnectOverlay();
  });

  
  socket.on("state", function(settings) {
    $sourceButtons.removeClass("selected").removeClass("pending");
    $sourceButtons.filter("[data-param='" + settings.input + "']").addClass("selected");

    $audioButtons.removeClass("pending");

    $("#volume-default").removeClass("pending");

    if(settings.mute){
      $("#mute").addClass("mute-active");
    } else {
      $("#mute").removeClass("mute-active");
    }

    $("#audio-level").html( (settings.volume * 100).toFixed(1) );
  });

  socket.on("projector-state", function(state) {

    var label = "";

    $("#projector-off").removeClass("pending");
    $("#projector-on").removeClass("pending");

    switch(state.power){
      case "off":
        label = "Off";
        $("#projector-off").addClass("disabled");
        $("#projector-on").removeClass("disabled");
        break;
      
      case "on":
        label = "On";
        $("#projector-on").addClass("disabled");
        $("#projector-off").removeClass("disabled");
        break;

      case "cooldown":
        label = "Off (<span class=\"cooldown\">cooling down</span>)";
        $("#projector-on").addClass("disabled");
        $("#projector-off").addClass("disabled");
        break;

      default:
        label = "unknown";
        $("#projector-on").addClass("disabled");
        $("#projector-off").addClass("disabled");
        break;
    }
    $("#projector-status").html(label);
  });


  $sourceButtons.on("click", function(evt) {
    
    var btn = $(this);
    btn.addClass("pending");

    var command = btn.data("command");
    var source = btn.data("param");

    socket.emit("source", source);
  });

  $("#mute").on("click", function() {
    $("#mute").addClass("pending");
    socket.emit("mute");
  })

  $("#volume-default").on("click", function(evt) {
    $(this).addClass("pending");
    socket.emit("volume-default");
  });

  $("#volume-up").on("click", function(evt) {
    $(this).addClass("pending");
    socket.emit("volume-up");
  });

  $("#volume-down").on("click", function(evt) {
    $(this).addClass("pending");
    socket.emit("volume-down");
  });

  $("#projector-on").on("click", function(evt){
    var ok = confirm("Are you sure you want to turn the projector on?");
    if(ok) {
      $(this).addClass("pending");
      socket.emit("projector-on");
    }
  });

  $("#projector-off").on("click", function(evt){
    var ok = confirm("Are you sure you want to turn the projector off?");
    if(ok){
      $(this).addClass("pending");
      socket.emit("projector-off");
    }
  });
});
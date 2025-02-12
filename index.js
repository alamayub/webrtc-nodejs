const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",  // or specify your frontend's URL
    methods: ["GET", "POST"],
  },
});

const users = {}; // { socketId: { userId, username, connected } }
const pairs = {}; // { socketId1: socketId2, socketId2: socketId1 }
const waitingUsers = []; // Queue for unpaired users

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("setUserName", (username) => handleSetUserName(socket, username));
  socket.on("message", (data) => handleMessage(socket, data));
  socket.on("typing", () => handleTyping(socket));
  socket.on("leaveChat", () => handleLeaveChat(socket));
  socket.on("disconnect", () => handleDisconnect(socket));

  // WebRTC Signaling
  socket.on("offer", (offer) => handleWebRTC(socket, "offer", offer));
  socket.on("answer", (answer) => handleWebRTC(socket, "answer", answer));
  socket.on("candidate", (candidate) => handleWebRTC(socket, "candidate", candidate));
});

server.listen(4000, () => console.log("Server running on http://localhost:4000"));

// ================== Event Handlers ================== //
function handleSetUserName(socket, username) {
  console.log("USERNAME:", username);

  users[socket.id] = { userId: socket.id, username, date: new Date().toISOString() };

  if (waitingUsers.length > 0) {
    // Pair the user with the first waiting user
    const partnerId = waitingUsers.shift();
    createPair(socket.id, partnerId);
    console.log("here 42");
  } else {
    console.log("here 44")
    waitingUsers.push(socket.id);
    io.to(socket.id).emit("waiting", "Waiting for a partner...");
  }

  io.emit("userList", Object.values(users));
}

function handleMessage(socket, data) {
  console.log(data);
  const partnerId = pairs[socket.id];
  if (!partnerId) return socket.emit("error", "You are not paired with anyone.");

  const message = {
    text: data,
    senderId: socket.id,
    sender: users[socket.id]?.username || "Unknown",
    date: new Date().toISOString(),
  };

  io.to(socket.id).emit("message", message);
  io.to(partnerId).emit("message", message);
}

function handleTyping(socket) {
  const partnerId = pairs[socket.id];
  if (partnerId) io.to(partnerId).emit("typing", users[socket.id]?.username || "Someone");
}

function handleLeaveChat(socket) {
  const partnerId = pairs[socket.id];
  if (partnerId) {
    io.to(partnerId).emit("partnerLeft", {
      partnerId: socket.id,
      partnerUsername: users[socket.id]?.username,
      date: new Date().toISOString(),
    });
    delete pairs[partnerId];
  }

  delete pairs[socket.id];

  // Allow the user to be matched again
  if (!waitingUsers.includes(socket.id)) waitingUsers.push(socket.id);
  io.to(socket.id).emit("waiting", "You left the chat. Waiting for a new partner...");
}

function handleDisconnect(socket) {
  const userInfo = users[socket.id];
  if (!userInfo) return;

  console.log(`User ${userInfo.username} disconnected:`, socket.id);
  const partnerId = pairs[socket.id];

  if (partnerId) {
    io.to(partnerId).emit("partnerDisconnected", {
      partnerId: socket.id,
      partnerUsername: userInfo.username,
      date: new Date().toISOString(),
    });
    delete pairs[partnerId];
  }

  delete users[socket.id];
  delete pairs[socket.id];

  // Remove from waiting queue if they were waiting
  const index = waitingUsers.indexOf(socket.id);
  if (index !== -1) waitingUsers.splice(index, 1);

  io.emit("userList", Object.values(users));
}

// ================== Utility Functions ================== //
function createPair(user1, user2) {
  pairs[user1] = user2;
  pairs[user2] = user1;
  const date = new Date().toISOString();

  io.to(user1).emit("paired", { partnerId: user2, partnerUsername: users[user2].username, date });
  io.to(user2).emit("paired", { partnerId: user1, partnerUsername: users[user1].username, date });
}

function handleWebRTC(socket, event, data) {
  const partnerId = pairs[socket.id];
  if (partnerId) io.to(partnerId).emit(event, data);
}

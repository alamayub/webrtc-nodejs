const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const users = {}; // { socketId: { userId, username, connected } }
const pairs = {}; // { socketId1: socketId2, socketId2: socketId1 }
let waitingUser = null; // Track unpaired users

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("setUserName", (username) => {
    if (Object.values(users).some((user) => user.username === username)) {
      io.to(socket.id).emit("error", "Username already taken. Choose another.");
      return;
    }

    users[socket.id] = {
      userId: socket.id,
      username,
      date: new Date().toISOString(),
    };

    if (waitingUser && waitingUser !== socket.id) {
      const date = new Date().toISOString();
      // Pair users
      pairs[socket.id] = waitingUser;
      pairs[waitingUser] = socket.id;

      io.to(socket.id).emit("paired", {
        partnerId: waitingUser,
        partnerUsername: users[waitingUser].username,
        date: date,
      });
      io.to(waitingUser).emit("paired", {
        partnerId: socket.id,
        partnerUsername: username,
        date: date,
      });

      waitingUser = null; // Reset waiting user
    } else {
      waitingUser = socket.id;
      io.to(socket.id).emit("waiting", "Waiting for a partner...");
    }

    io.emit("userList", Object.values(users));
  });

  socket.on("message", (data) => {
    console.log(data);
    const partnerId = pairs[socket.id];
    if (!partnerId) {
      socket.emit("error", "You are not paired with anyone.");
      return;
    }

    const message = {
      text: data,
      senderId: socket.id,
      sender: users[socket.id]?.username || "Unknown",
      date: new Date().toISOString(),
    };

    io.to(socket.id).emit("message", message);
    io.to(partnerId).emit("message", message);
  });

  socket.on("typing", () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("typing", users[socket.id]?.username || "Someone");
    }
  });

  socket.on("leaveChat", () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("partnerLeft", {
        partnerId: socket.id,
        partnerUsername: users[socket.id].username,
        date: new Date().toISOString(),
      });
      delete pairs[partnerId];
    }

    delete pairs[socket.id];
    waitingUser = socket.id;
    io.to(socket.id).emit(
      "waiting",
      "You left the chat. Waiting for a new partner..."
    );
  });

  socket.on("disconnect", () => {
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
    if (waitingUser === socket.id) waitingUser = null;

    io.emit("userList", Object.values(users));
  });

  // WebRTC Signaling
  socket.on("offer", (offer) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit("offer", offer);
  });

  socket.on("answer", (answer) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit("answer", answer);
  });

  socket.on("candidate", (candidate) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit("candidate", candidate);
  });
});

server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
// import {
//   createChatRoomRepository,
//   getChatRoomRepository,
//   initialize,
// } from "./src/config/redis";
// import { syncChatRoom } from "./src/controllers/roomController";

// await initialize();

// const repo = getChatRoomRepository();

// const chatId = "room-1751388202957";

// let messages = await repo.getMessages(chatId, 0, 100);

// let nickanmeMap: Map<string, string> = new Map();

// // for each of the messages, we add senderNickname property to it
// messages = await Promise.all(
//   messages.map(async (message) => {
//     if (message.sender && message.sender !== "system") {
//       if (!nickanmeMap.has(message.sender)) {
//         const nickname = await repo.getNickname(chatId, message.sender);
//         nickanmeMap.set(message.sender, nickname || "[Unknown]");
//       }
//       return {
//         ...message,
//         senderNickname: nickanmeMap.get(message.sender) || "[Unknown]",
//       };
//     } else {
//       return {
//         ...message,
//       };
//     }
//   })
// );

// messages.forEach((msg) => {
//   console.log(msg.senderNickname);
// });

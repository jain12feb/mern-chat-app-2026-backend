import { Server, Socket } from 'socket.io';

const onlineUsers = new Map(); // userId -> socketId

export default (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`New client connected: ${socket.id}`);

    // Setup user personal room
    socket.on('setup', (userData) => {
      socket.join(userData.id);
      onlineUsers.set(userData.id, socket.id);
      socket.emit('connected');
      
      // Broadcast online users to everyone
      io.emit('get_online_users', Array.from(onlineUsers.keys()));
    });

    // Join specific chat
    socket.on('join_chat', (room) => {
      socket.join(room);
      console.log(`User Joined Room: ${room}`);
    });

    socket.on('typing', (data) => {
      const room = typeof data === 'string' ? data : data.chatId;
      socket.in(room).emit('typing', data);
    });
    socket.on('stop_typing', (data) => {
      const room = typeof data === 'string' ? data : data.chatId;
      socket.in(room).emit('stop_typing', data);
    });

    // Handle group updates (rename, add, remove)
    socket.on('group_update', (updatedChat) => {
      // Notify everyone in the chat room about the update
      socket.in(updatedChat._id).emit('group_updated_rec', updatedChat);
    });

    socket.on('user_added_to_group', ({ chat, userId }) => {
      // Notify the specific user they've been added
      socket.in(userId).emit('added_to_group_rec', chat);
    });

    socket.on('user_removed_from_group', ({ chatId, userId }) => {
      // Notify the specific user they've been removed
      socket.in(userId).emit('removed_from_group_rec', { chatId });
    });

    // Handle incoming messages
    socket.on('send_message', (newMessage) => {
      const chat = newMessage.chatId;
      if (!chat?.participants) return console.log('chat.participants not defined');

      chat.participants.forEach((user: any) => {
        const userIdStr = user._id ? user._id.toString() : user.toString();
        const senderIdStr = newMessage.senderId._id ? newMessage.senderId._id.toString() : newMessage.senderId.toString();
        if (userIdStr === senderIdStr) return;
        console.log("Emitting message to", userIdStr); 
        io.to(userIdStr).emit('receive_message', newMessage);
      });
    });

    socket.on('update_message', (updatedMessage) => {
      const chatId = updatedMessage.chatId?._id || updatedMessage.chatId;
      if (!chatId) return;
      socket.to(chatId.toString()).emit('message_updated', updatedMessage);
    });

    socket.on('delete_message', (deletedMessage) => {
      const chatId = deletedMessage.chatId?._id || deletedMessage.chatId;
      if (!chatId) return;
      socket.to(chatId.toString()).emit('message_deleted', deletedMessage);
    });

    socket.on('send_reaction', (updatedMessage) => {
      const chatId = updatedMessage.chatId?._id || updatedMessage.chatId;
      if (!chatId) return;

      console.log(`Broadcasting reaction to chat room: ${chatId}`);
      // Broadcast to everyone in the chat room except the sender
      socket.to(chatId.toString()).emit('message_reaction_updated', updatedMessage);
    });
    
    socket.on('pin_message', (updatedChat) => {
      const chatId = updatedChat._id;
      if (!chatId) return;
      socket.to(chatId.toString()).emit('pin_updated', updatedChat);
    });

    // --- WebRTC Signaling ---
    
    // 1. Initial Ringing & Call State (1-on-1)
    socket.on('webrtc_call_user', ({ userToCall, from, name, type, chatId }) => {
      io.to(userToCall).emit('webrtc_call_incoming', { from, name, type, chatId });
    });

    socket.on('webrtc_answer_call', ({ to }) => {
      io.to(to).emit('webrtc_call_accepted');
    });

    socket.on('webrtc_reject_call', ({ to }) => {
      io.to(to).emit('webrtc_call_rejected');
    });

    socket.on('webrtc_end_call', ({ to }) => {
      if (Array.isArray(to)) {
        to.forEach(user => io.to(user).emit('webrtc_call_ended'));
      } else if (to) {
        io.to(to).emit('webrtc_call_ended');
      }
    });

    // 2. Group Call Management
    socket.on('join_group_call', ({ chatId, userId, name }) => {
      const room = `call_${chatId}`;
      socket.join(room);
      // Tell others in the call room that someone joined so they can initiate offers
      socket.to(room).emit('user_joined_call', { userId, name });
    });

    socket.on('leave_group_call', ({ chatId, userId }) => {
      const room = `call_${chatId}`;
      socket.leave(room);
      socket.to(room).emit('user_left_call', { userId });
    });

    // 3. WebRTC Core Negotiation (SDP & ICE)
    socket.on('webrtc_offer', ({ target, caller, sdp, type, name }) => {
      io.to(target).emit('webrtc_offer', { caller, sdp, type, name });
    });

    socket.on('webrtc_answer', ({ target, answerer, sdp }) => {
      io.to(target).emit('webrtc_answer', { answerer, sdp });
    });

    socket.on('webrtc_ice_candidate', ({ target, candidate, from }) => {
      io.to(target).emit('webrtc_ice_candidate', { candidate, from });
    });

    // Mark as read
    socket.on('mark_as_read', async ({ chatId, userId }) => {
      try {
        const Chat = require('../models/Chat').default;
        const Message = require('../models/Message').default;
        
        // Update unread count for the user
        const chat = await Chat.findById(chatId);
        if (chat) {
          const userCount = chat.unreadCounts.find((uc: any) => uc.user.toString() === userId);
          if (userCount && userCount.count > 0) {
            userCount.count = 0;
            await chat.save();
          }
        }

        // Add userId to readBy for all unread messages they didn't send
        const updatedMessages = await Message.updateMany(
          { chatId, senderId: { $ne: userId }, readBy: { $ne: userId } },
          { $push: { readBy: userId } }
        );

        if (updatedMessages.modifiedCount > 0) {
          // Find unique senders of those messages and notify each via their personal room
          const affectedSenderIds = await Message.find({ chatId, readBy: userId })
            .distinct('senderId');

          affectedSenderIds.forEach((senderId: any) => {
            const senderIdStr = senderId.toString();
            if (senderIdStr !== userId) {
              io.in(senderIdStr).emit("messages_read", { chatId, readerId: userId });
            }
          });
        }
      } catch (err) {
        console.error('Error marking as read:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      
      // Find and remove user from onlineUsers
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          break;
        }
      }
      
      // Broadcast updated list
      io.emit('get_online_users', Array.from(onlineUsers.keys()));
    });
  });
};

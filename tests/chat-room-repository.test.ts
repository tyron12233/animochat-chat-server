import { Redis } from 'ioredis';
import { ChatRoomRepository } from '../src/chat-room-repository'; // Adjust path if needed
import { type ChatThemeV2, type Message } from '../src/types'; 

describe('ChatRoomRepository', () => {
  let repo: ChatRoomRepository;
  let redisClient: Redis;
  const testChatId = 'test-room-123';
  const sampleTheme: ChatThemeV2 = {
    name: 'Test Theme',
    typography: { fontFamily: 'Arial', baseFontSize: '16px' },
    general: { background: { light: '#fff', dark: '#000' }, backdropBlur: '5px', shadow: 'none', borderRadius: '10px' },
    header: { background: { light: '#eee', dark: '#333' }, border: { light: '#ddd', dark: '#444' }, statusLabel: { light: '#666', dark: '#aaa' }, statusValue: { light: '#000', dark: '#fff' } },
    // Abridged theme for testing purposes
  } as ChatThemeV2; 

  // Before all tests, connect to a separate test database
  beforeAll(() => {
    // Connect to Redis DB 1 for testing to isolate from dev data in DB 0
    redisClient = new Redis(process.env.REDIS_URL!, { db: 1 });
    repo = new ChatRoomRepository(redisClient);
  });

  // Before each test, flush the entire test database to ensure a clean slate
  beforeEach(async () => {
    await redisClient.flushdb();
  });

  // After all tests are done, close the connection
  afterAll(async () => {
    await redisClient.quit();
  });

  describe('Room Management', () => {
    it('should create a room and confirm it exists', async () => {
      // Act
      await repo.createRoom(testChatId, 'Test Room', 10);
      const exists = await repo.roomExists(testChatId);
      const info = await repo.getRoomInfo(testChatId);

      // Assert
      expect(exists).toBe(true);
      expect(info.name).toBe('Test Room');
      expect(info.maxParticipants).toBe('10'); // Redis stores hash values as strings
    });

    it('should return false for a non-existent room', async () => {
      // Act
      const exists = await repo.roomExists('non-existent-room');
      
      // Assert
      expect(exists).toBe(false);
    });
  });

  describe('Message Management', () => {
    it('should add messages and retrieve them in chronological order', async () => {
      // Arrange
      const message1: Message = { id: 'msg1', content: 'Hello', sender: 'user1', created_at: new Date().toISOString(), session_id: testChatId,  };
      const message2: Message = { id: 'msg2', content: 'World', sender: 'user2', created_at: new Date().toISOString(), session_id: testChatId,  };
      
      // Act
      await repo.addMessage(testChatId, message1);
      await repo.addMessage(testChatId, message2);
      const retrievedMessages = await repo.getMessages(testChatId, 0, 10);

      


      // Assert
      expect(retrievedMessages).toHaveLength(2);
      // Redis LPUSH adds to the left, so the last message pushed is the first in the list.
      // Our getMessages method reverses this to ensure chronological order.
      expect(retrievedMessages[0]!.content).toBe('Hello');
      expect(retrievedMessages[1]!.content).toBe('World');
      expect(retrievedMessages[1]).toEqual(message2);
    });

    it('should only persist the last 100 messages', async () => {
      // Arrange: Add 105 messages
      for (let i = 0; i < 105; i++) {
        const message: Message = {
          id: `msg${i}`,
          content: `Message content ${i}`,
          sender: 'user1',
          created_at: new Date().toISOString(),
          session_id: testChatId,
        };
        await repo.addMessage(testChatId, message);
      }

      // Act
      const messageCount = await repo.getMessageCount(testChatId);
      const messages = await repo.getMessages(testChatId, 0, 99);
      const messageContents = messages.map(m => m.content);

      // Assert
      // 1. Check that the total count is exactly 100
      expect(messageCount).toBe(100);
      expect(messages).toHaveLength(100);

      // 2. Check that the oldest messages (0-4) are gone
      expect(messageContents).not.toContain('Message content 0');
      expect(messageContents).not.toContain('Message content 4');
      
      // 3. Check that the newest messages (5-104) are present
      expect(messageContents).toContain('Message content 5');
      expect(messageContents).toContain('Message content 104');
    })
  });

  describe('Participant and Nickname Management', () => {
    it('should add and remove a participant', async () => {
      // Arrange
      const userId = 'user-abc';
      
      // Act & Assert
      await repo.addParticipant(testChatId, userId, 'TestUser');
      let count = await repo.getParticipantCount(testChatId);
      let ids = await repo.getParticipantIds(testChatId);
      
      expect(count).toBe(1);
      expect(ids).toContain(userId);

      await repo.removeParticipant(testChatId, userId);
      count = await repo.getParticipantCount(testChatId);
      ids = await repo.getParticipantIds(testChatId);

      expect(count).toBe(0);
      expect(ids).not.toContain(userId);
    });
    
    it('should set and get nicknames', async () => {
        // Arrange
        const userId1 = 'user-1';
        const userId2 = 'user-2';

        // Act
        await repo.setNickname(testChatId, userId1, 'Alice');
        await repo.setNickname(testChatId, userId2, 'Bob');

        const nickname1 = await repo.getNickname(testChatId, userId1);
        const allNicknames = await repo.getNicknames(testChatId);

        // Assert
        expect(nickname1).toBe('Alice');
        expect(allNicknames).toBeInstanceOf(Map);
        expect(allNicknames.get(userId1)).toBe('Alice');
        expect(allNicknames.get(userId2)).toBe('Bob');
    });
  });

  describe('Ban Management', () => {
    it('should ban a user and verify the ban status', async () => {
        // Arrange
        const userIdToBan = 'banned-user-456';
        const otherUserId = 'safe-user-789';

        // Act
        await repo.banUser(testChatId, userIdToBan);
        const isBanned = await repo.isUserBanned(testChatId, userIdToBan);
        const isOtherUserBanned = await repo.isUserBanned(testChatId, otherUserId);

        // Assert
        expect(isBanned).toBe(true);

        expect(isOtherUserBanned).toBe(false);
    });
  });

   // ====================================================================
  // NEW TEST SUITE: Theme Management
  // ====================================================================
  describe('Theme Management', () => {
    it('should set and get a theme correctly', async () => {
        // Act
        await repo.setTheme(testChatId, sampleTheme, 'dark');
        const { theme, mode } = await repo.getTheme(testChatId);

        // Assert
        expect(mode).toBe('dark');
        expect(theme).toEqual(sampleTheme);
    });

    it('should return null theme when none is set', async () => {
        // Act
        const { theme, mode } = await repo.getTheme(testChatId);

        // Assert
        expect(theme).toBeNull();
        expect(mode).toBe('light'); // Should return default mode
    });

    it('should return null for an empty object theme', async () => {
        // Arrange
        // Manually set an empty object as the theme
        await redisClient.hset(`chat:${testChatId}:info`, 'theme', JSON.stringify({}));

        // Act
        const { theme } = await repo.getTheme(testChatId);
        
        // Assert
        expect(theme).toBeNull();
    });

    // Use test.each to run the same test for different corrupted data inputs
    test.each([
        ['[object Object]'],
        ['null'],
        ['{}'],
        ['invalid-json'],
        ['{"key": "value",'] // Incomplete JSON
    ])('should return null theme for corrupted data: "%s"', async (corruptedData) => {
        // Arrange: Manually set a corrupted string as the theme value in Redis
        await redisClient.hset(`chat:${testChatId}:info`, 'theme', corruptedData);
        await redisClient.hset(`chat:${testChatId}:info`, 'mode', 'dark');

        // Act
        const { theme, mode } = await repo.getTheme(testChatId);

        // Assert
        expect(theme).toBeNull();
        expect(mode).toBe('dark'); // Mode should still be retrieved correctly
    });
  });
});
import { z } from 'zod';

export const createGroupSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Group name is required'),
    users: z.string().refine((val) => {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) && parsed.length >= 2;
      } catch {
        return false;
      }
    }, 'At least 2 users are required'),
  }),
});

export const renameGroupSchema = z.object({
  body: z.object({
    chatId: z.string().min(1, 'Chat ID is required'),
    chatName: z.string().min(1, 'New name is required'),
  }),
});

export const groupActionSchema = z.object({
  body: z.object({
    chatId: z.string().min(1, 'Chat ID is required'),
    userId: z.string().min(1, 'User ID is required'),
  }),
});

import express from 'express';
import { allMessages, sendMessage, sendMediaMessage, updateMessage, deleteMessage, reactToMessage, searchMessages, votePoll, getUploadUrl } from '../controllers/messageController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

router.route('/search').get(protect, searchMessages);
router.route('/upload-url').post(protect, getUploadUrl);
router.route('/:chatId').get(protect, allMessages);
router.route('/').post(protect, sendMessage);
router.route('/media').post(protect, sendMediaMessage);
router.route('/:id').put(protect, updateMessage).delete(protect, deleteMessage);
router.route('/:id/react').post(protect, reactToMessage);
router.route('/:id/poll-vote').post(protect, votePoll);

export default router;

import express from 'express';
import { registerUser, loginUser, logoutUser, refreshAccessToken, updateProfile, checkUsername, deleteAccount } from '../controllers/authController';
import { validate } from '../middlewares/validateMiddleware';
import { registerSchema, loginSchema, updateProfileSchema } from '../validations/authValidation';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

router.post('/register', validate(registerSchema), registerUser);
router.post('/login', validate(loginSchema), loginUser);
router.post('/logout', logoutUser);
router.post('/refresh', refreshAccessToken);
router.get('/check-username/:username', checkUsername);
router.put('/profile', protect, validate(updateProfileSchema), updateProfile);
router.delete('/account', protect, deleteAccount);

export default router;

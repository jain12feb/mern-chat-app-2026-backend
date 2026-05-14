import jwt from 'jsonwebtoken';

export const generateTokens = (userId: string) => {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'secret-access-token-key',
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.REFRESH_SECRET || 'secret-refresh-token-key',
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
};

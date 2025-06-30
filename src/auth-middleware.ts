import type { NextFunction, Request, Response } from "express";



/**
 * Middleware to protect routes by validating a JWT with the auth service.
 * It checks for a 'Bearer' token in the Authorization header.
 * If the token is valid, it attaches the user's data and role to the request object.
 */
const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: "Authentication required. No token provided." });
    return;
  }

  const token = authHeader.split(' ')[1];
  const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'https://animochat-auth-server.onrender.com';

  try {
    // Call your auth server's /validate endpoint
    const response = await fetch(`${AUTH_SERVER_URL}/api/auth/validate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const validationData: any = await response.json();

    if (!response.ok || !validationData.valid) {
      res.status(401).json({ error: "Invalid or expired token." });
      return;
    }

    // Attach user information to the request object for use in subsequent handlers
    (req as any).user = {
        id: validationData.user.id,
        role: validationData.role, 
        ...validationData.user
    };

    next(); 
  } catch (error) {
    console.error("Error validating token:", error);
    res.status(500).json({ error: "Could not connect to authentication service." });
  }
};

export default authMiddleware;

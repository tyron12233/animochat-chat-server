
import type { NextFunction, Request, Response } from "express";
import { getChatRoomRepository } from "../config/redis";

export default async function checkIpBan(
  req: any,
  res: any,
  next: NextFunction
) {
  const ip = req.ip;

  if (!ip) {
    // This case is unlikely if 'trust proxy' is configured, but as a safeguard,
    // we'll log a warning and allow the request to proceed.
    console.warn("Could not determine IP address for an incoming request.");
    return next();
  }

  const repo = getChatRoomRepository();

  try {
    const isBanned = await repo.isIpBanned("", ip);
    if (isBanned) {
      // If the IP is banned, send a 403 Forbidden response and stop processing.
      return res
        .status(403)
        .json({ message: "Access from your IP address has been restricted." });
    }

    return next();
  } catch (error) {
    console.error("Redis error while checking IP ban status:", error);
    return next();
  }
}


import type { NextFunction, Request, Response } from "express";
import { getChatRoomRepository } from "../config/redis";

console.log("checkIpBan middleware loaded");

export default async function checkIpBan(
  req: any,
  res: any,
  next: NextFunction
) {
  const ip = req.ip;

  if (!ip) {
    return next();
  }

  const repo = getChatRoomRepository();

  try {
    const isBanned = await repo.isIpBanned("", ip);
    if (isBanned) {
      // If the IP is banned, send a 403 Forbidden response and stop processing.
      return res
        .status(403)
        .json({ message: "Access denied." });
    }

    return next();
  } catch (error) {
    console.error("Error while checking IP ban status:", error);
    return next();
  }
}

import { Router } from "express";
import { createRoom, deleteRoom, getRooms, ghostMode, syncChatRoom } from "../controllers/roomController";
import authMiddleware from "../auth-middleware";


const router = Router();

router.get("/rooms", getRooms)
router.get("/sync/:chatId", syncChatRoom)
router.post("/create-room", authMiddleware, createRoom)
router.post("/ghost-mode", authMiddleware, ghostMode)

router.post("/delete-room", authMiddleware, deleteRoom)


export default router;
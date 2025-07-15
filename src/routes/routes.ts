import { Router } from "express";
import { banUser, createRoom, deleteRoom, getRooms, ghostMode, shadowBanUser, syncChatRoom } from "../controllers/roomController";
import authMiddleware from "../auth-middleware";


const router = Router();

router.get("/rooms", getRooms)
router.get("/sync/:chatId", syncChatRoom)
router.post("/create-room", authMiddleware, createRoom)
router.post("/ghost-mode", authMiddleware, ghostMode)
router.post("/delete-room", authMiddleware, deleteRoom)
router.post( "/ban/:chatId/:userId", authMiddleware, banUser)
router.post("/shadow-ban/:chatId/:userId", authMiddleware, shadowBanUser);

export default router;
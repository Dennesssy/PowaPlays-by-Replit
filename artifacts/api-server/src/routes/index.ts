import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import usersRouter from "./users";
import favoritesRouter from "./favorites";
import feedbackRouter from "./feedback";
import analyticsRouter from "./analytics";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(usersRouter);
router.use(favoritesRouter);
router.use(feedbackRouter);
router.use(analyticsRouter);
router.use(notificationsRouter);

export default router;

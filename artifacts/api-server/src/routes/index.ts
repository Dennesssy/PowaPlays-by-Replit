import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import usersRouter from "./users";
import favoritesRouter from "./favorites";
import feedbackRouter from "./feedback";
import analyticsRouter from "./analytics";
import notificationsRouter from "./notifications";
import syncRouter from "./sync";
import adminRouter from "./admin";
import replsRouter from "./repls";
import projectAnalyticsRouter from "./projectAnalytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(usersRouter);
router.use(favoritesRouter);
router.use(feedbackRouter);
router.use(analyticsRouter);
router.use(notificationsRouter);
router.use(syncRouter);
router.use(adminRouter);
router.use(replsRouter);
router.use(projectAnalyticsRouter);

export default router;

import { flatRoutes } from "@remix-run/fs-routes";

export default flatRoutes({ ignoredRouteFiles: ["**/*.test.ts", "**/*.test.tsx"] });

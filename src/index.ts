import { createEvent, createStore, guard, restore, sample } from 'effector';
import { Location, createBrowserHistory } from 'history';
import * as lib from './lib';
import type { RouteObject, RouteMatch } from './typings';

const history = createBrowserHistory();
const locationChanged = createEvent<Location>();

export const $location = restore(locationChanged, null);
export const $pathname = $location.map((location) =>
  location ? location.pathname : ""
);

export const pushed = createEvent<string>();

// eslint-disable-next-line effector/no-watch
pushed.watch(history.push);

history.listen(({ location }) => {
  locationChanged(location);
});

export const routeInitialized = createEvent<RouteObject>();
export const routeDestroyed = createEvent<{ path: string }>();

export const $routes = createStore<RouteObject[]>([]);

$routes
  .on(routeInitialized, (routes, route) => [...routes, route])
  .on(routeDestroyed, (routes, destroyedRoute) =>
    routes.filter((route) => route.path !== destroyedRoute.path)
  );

export const $matchedRoutes = createStore<RouteMatch[]>([]);

sample({
  clock: guard({
    clock: $location,
    filter: Boolean,
  }),
  source: $routes,
  fn: (routes, location) => lib.matchRoutes(routes, location) || [],
  target: $matchedRoutes,
});

/*
  MIT License

  Copyright (c) React Training 2015-2019 Copyright (c) Remix Software 2020-2021

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import type { Location, Path, To } from 'history';
import { parsePath } from 'history';
import type { RouteObject, RouteMatch } from '../typings';

function invariant(cond: any, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function warning(cond: any, message: string): void {
  if (!cond) {
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.warn(message);

    try {
      throw new Error(message);
      // eslint-disable-next-line no-empty
    } catch (e) {}
  }
}

/**
 * The parameters that were parsed from the URL path.
 */
export type Params<Key extends string = string> = {
  readonly [key in Key]: string | undefined;
};

/**
 * Returns a path with params interpolated.
 *
 * @see https://reactrouter.com/docs/en/v6/api#generatepath
 */
export function generatePath(path: string, params: Params = {}): string {
  return path
    .replace(/:(\w+)/g, (_, key) => {
      invariant(params[key] != null, `Missing ":${key}" param`);
      return params[key]!;
    })
    .replace(/\/*\*$/, () =>
      params['*'] == null ? '' : params['*'].replace(/^\/*/, '/')
    );
}

/**
 * Matches the given routes to a location and returns the match data.
 *
 * @see https://reactrouter.com/docs/en/v6/api#matchroutes
 */
export function matchRoutes(
  routes: RouteObject[],
  locationArg: Partial<Location> | string,
  basename = '/'
): RouteMatch[] | null {
  const location =
    typeof locationArg === 'string' ? parsePath(locationArg) : locationArg;

  const pathname = stripBasename(location.pathname || '/', basename);

  if (pathname == null) {
    return null;
  }

  const branches = flattenRoutes(routes);
  rankRouteBranches(branches);

  let matches = null;
  for (let i = 0; matches == null && i < branches.length; i += 1) {
    matches = matchRouteBranch(branches[i], routes, pathname);
  }

  return matches;
}

interface RouteMeta {
  relativePath: string;
  caseSensitive: boolean;
  childrenIndex: number;
}

interface RouteBranch {
  path: string;
  score: number;
  routesMeta: RouteMeta[];
}

function flattenRoutes(
  routes: RouteObject[],
  branches: RouteBranch[] = [],
  parentsMeta: RouteMeta[] = [],
  parentPath = ''
): RouteBranch[] {
  routes.forEach((route, index) => {
    const meta: RouteMeta = {
      relativePath: route.path || '',
      caseSensitive: route.caseSensitive === true,
      childrenIndex: index,
    };

    if (meta.relativePath.startsWith('/')) {
      invariant(
        meta.relativePath.startsWith(parentPath),
        `Absolute route path "${meta.relativePath}" nested under path ` +
          `"${parentPath}" is not valid. An absolute child route path ` +
          'must start with the combined path of all its parent routes.'
      );

      meta.relativePath = meta.relativePath.slice(parentPath.length);
    }

    const path = joinPaths([parentPath, meta.relativePath]);
    const routesMeta = parentsMeta.concat(meta);

    // Routes without a path shouldn't ever match by themselves unless they are
    // index routes, so don't add them to the list of possible branches.
    if (route.path == null && !route.index) {
      return;
    }

    branches.push({
      path,
      score: computeScore(path, !!route.index),
      routesMeta,
    });
  });

  return branches;
}

function rankRouteBranches(branches: RouteBranch[]): void {
  branches.sort((a, b) =>
    a.score !== b.score
      ? b.score - a.score // Higher score first
      : compareIndexes(
          a.routesMeta.map((meta) => meta.childrenIndex),
          b.routesMeta.map((meta) => meta.childrenIndex)
        )
  );
}

const paramRe = /^:\w+$/;
const dynamicSegmentValue = 3;
const indexRouteValue = 2;
const emptySegmentValue = 1;
const staticSegmentValue = 10;
const splatPenalty = -2;
const isSplat = (s: string) => s === '*';

function computeScore(path: string, index: boolean | undefined): number {
  const segments = path.split('/');
  let initialScore = segments.length;
  if (segments.some(isSplat)) {
    initialScore += splatPenalty;
  }

  if (index) {
    initialScore += indexRouteValue;
  }

  return segments
    .filter((s) => !isSplat(s))
    .reduce(
      (score, segment) =>
        score +
        (paramRe.test(segment)
          ? dynamicSegmentValue
          : segment === ''
          ? emptySegmentValue
          : staticSegmentValue),
      initialScore
    );
}

function compareIndexes(a: number[], b: number[]): number {
  const siblings =
    a.length === b.length && a.slice(0, -1).every((n, i) => n === b[i]);

  return siblings
    ? a[a.length - 1] - b[b.length - 1]
    : // If two routes are siblings, we should try to match the earlier sibling
      // first. This allows people to have fine-grained control over the matching
      // behavior by simply putting routes with identical paths in the order they
      // want them tried.
      0;
  // Otherwise, it doesn't really make sense to rank non-siblings by index,
  // so they sort equally.
}

function matchRouteBranch<ParamKey extends string = string>(
  branch: RouteBranch,
  // TODO: attach original route object inside routesMeta so we don't need this arg
  routesArg: RouteObject[],
  pathname: string
): RouteMatch<ParamKey>[] | null {
  let routes = routesArg;
  const { routesMeta } = branch;

  const matchedParams = {};
  let matchedPathname = '/';
  const matches: RouteMatch[] = [];
  for (let i = 0; i < routesMeta.length; i += 1) {
    const meta = routesMeta[i];
    const end = i === routesMeta.length - 1;
    const remainingPathname =
      matchedPathname === '/'
        ? pathname
        : pathname.slice(matchedPathname.length) || '/';
    const match = matchPath(
      { path: meta.relativePath, caseSensitive: meta.caseSensitive, end },
      remainingPathname
    );

    if (!match) return null;

    Object.assign(matchedParams, match.params);

    const route = routes[meta.childrenIndex];

    matches.push({
      params: matchedParams,
      pathname: joinPaths([matchedPathname, match.pathname]),
      pathnameBase: joinPaths([matchedPathname, match.pathnameBase]),
      route,
    });

    if (match.pathnameBase !== '/') {
      matchedPathname = joinPaths([matchedPathname, match.pathnameBase]);
    }

    routes = [];
  }

  return matches;
}

/**
 * A PathPattern is used to match on some portion of a URL pathname.
 */
export interface PathPattern {
  /**
   * A string to match against a URL pathname. May contain `:id`-style segments
   * to indicate placeholders for dynamic parameters. May also end with `/*` to
   * indicate matching the rest of the URL pathname.
   */
  path: string;
  /**
   * Should be `true` if the static portions of the `path` should be matched in
   * the same case.
   */
  caseSensitive?: boolean;
  /**
   * Should be `true` if this pattern should match the entire URL pathname.
   */
  end?: boolean;
}

/**
 * A PathMatch contains info about how a PathPattern matched on a URL pathname.
 */
export interface PathMatch<ParamKey extends string = string> {
  /**
   * The names and values of dynamic parameters in the URL.
   */
  params: Params<ParamKey>;
  /**
   * The portion of the URL pathname that was matched.
   */
  pathname: string;
  /**
   * The portion of the URL pathname that was matched before child routes.
   */
  pathnameBase: string;
  /**
   * The pattern that was used to match.
   */
  pattern: PathPattern;
}

type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Performs pattern matching on a URL pathname and returns information about
 * the match.
 *
 * @see https://reactrouter.com/docs/en/v6/api#matchpath
 */
export function matchPath<ParamKey extends string = string>(
  pattern: PathPattern | string,
  pathname: string
): PathMatch<ParamKey> | null {
  if (typeof pattern === 'string') {
    pattern = { path: pattern, caseSensitive: false, end: true };
  }

  const [matcher, paramNames] = compilePath(
    pattern.path,
    pattern.caseSensitive,
    pattern.end
  );

  const match = pathname.match(matcher);
  if (!match) return null;

  const matchedPathname = match[0];
  let pathnameBase = matchedPathname.replace(/(.)\/+$/, '$1');
  const captureGroups = match.slice(1);
  const params: Params = paramNames.reduce<Mutable<Params>>(
    (memo, paramName, index) => {
      // We need to compute the pathnameBase here using the raw splat value
      // instead of using params["*"] later because it will be decoded then
      if (paramName === '*') {
        const splatValue = captureGroups[index] || '';
        pathnameBase = matchedPathname
          .slice(0, matchedPathname.length - splatValue.length)
          .replace(/(.)\/+$/, '$1');
      }

      memo[paramName] = safelyDecodeURIComponent(
        captureGroups[index] || '',
        paramName
      );
      return memo;
    },
    {}
  );

  return {
    params,
    pathname: matchedPathname,
    pathnameBase,
    pattern,
  };
}

function compilePath(
  path: string,
  caseSensitive = false,
  end = true
): [RegExp, string[]] {
  warning(
    path === '*' || !path.endsWith('*') || path.endsWith('/*'),
    `Route path "${path}" will be treated as if it were ` +
      `"${path.replace(/\*$/, '/*')}" because the \`*\` character must ` +
      `always follow a \`/\` in the pattern. To get rid of this warning, ` +
      `please change the route path to "${path.replace(/\*$/, '/*')}".`
  );

  const paramNames: string[] = [];
  let regexpSource =
    '^' +
    path
      .replace(/\/*\*?$/, '') // Ignore trailing / and /*, we'll handle it below
      .replace(/^\/*/, '/') // Make sure it has a leading /
      .replace(/[\\.*+^$?{}|()[\]]/g, '\\$&') // Escape special regex chars
      .replace(/:(\w+)/g, (_: string, paramName: string) => {
        paramNames.push(paramName);
        return '([^\\/]+)';
      });

  if (path.endsWith('*')) {
    paramNames.push('*');
    regexpSource +=
      path === '*' || path === '/*'
        ? '(.*)$' // Already matched the initial /, just match the rest
        : '(?:\\/(.+)|\\/*)$'; // Don't include the / in params["*"]
  } else {
    regexpSource += end
      ? '\\/*$' // When matching to the end, ignore trailing slashes
      : // Otherwise, at least match a word boundary. This restricts parent
        // routes to matching only their own words and nothing more, e.g. parent
        // route "/home" should not match "/home2".
        '(?:\\b|$)';
  }

  const matcher = new RegExp(regexpSource, caseSensitive ? undefined : 'i');

  return [matcher, paramNames];
}

function safelyDecodeURIComponent(value: string, paramName: string) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    warning(
      false,
      `The value for the URL param "${paramName}" will not be decoded because` +
        ` the string "${value}" is a malformed URL segment. This is probably` +
        ` due to a bad percent encoding (${error}).`
    );

    return value;
  }
}

/**
 * Returns a resolved path object relative to the given pathname.
 *
 * @see https://reactrouter.com/docs/en/v6/api#resolvepath
 */
export function resolvePath(to: To, fromPathname = '/'): Path {
  const {
    pathname: toPathname,
    search = '',
    hash = '',
  } = typeof to === 'string' ? parsePath(to) : to;

  let pathname = toPathname
    ? toPathname.startsWith('/')
      ? toPathname
      : resolvePathname(toPathname, fromPathname)
    : fromPathname;

  return {
    pathname,
    search: normalizeSearch(search),
    hash: normalizeHash(hash),
  };
}

function resolvePathname(relativePath: string, fromPathname: string): string {
  const segments = fromPathname.replace(/\/+$/, '').split('/');
  const relativeSegments = relativePath.split('/');

  relativeSegments.forEach((segment) => {
    if (segment === '..') {
      // Keep the root "" segment so the pathname starts at /
      if (segments.length > 1) segments.pop();
    } else if (segment !== '.') {
      segments.push(segment);
    }
  });

  return segments.length > 1 ? segments.join('/') : '/';
}

function resolveTo(
  toArg: To,
  routePathnames: string[],
  locationPathname: string
): Path {
  let to = typeof toArg === 'string' ? parsePath(toArg) : toArg;
  let toPathname = toArg === '' || to.pathname === '' ? '/' : to.pathname;

  // If a pathname is explicitly provided in `to`, it should be relative to the
  // route context. This is explained in `Note on `<Link to>` values` in our
  // migration guide from v5 as a means of disambiguation between `to` values
  // that begin with `/` and those that do not. However, this is problematic for
  // `to` values that do not provide a pathname. `to` can simply be a search or
  // hash string, in which case we should assume that the navigation is relative
  // to the current location's pathname and *not* the route pathname.
  let from: string;
  if (toPathname == null) {
    from = locationPathname;
  } else {
    let routePathnameIndex = routePathnames.length - 1;

    if (toPathname.startsWith('..')) {
      let toSegments = toPathname.split('/');

      // Each leading .. segment means "go up one route" instead of "go up one
      // URL segment".  This is a key difference from how <a href> works and a
      // major reason we call this a "to" value instead of a "href".
      while (toSegments[0] === '..') {
        toSegments.shift();
        routePathnameIndex -= 1;
      }

      to.pathname = toSegments.join('/');
    }

    // If there are more ".." segments than parent routes, resolve relative to
    // the root / URL.
    from = routePathnameIndex >= 0 ? routePathnames[routePathnameIndex] : '/';
  }

  const path = resolvePath(to, from);

  // Ensure the pathname has a trailing slash if the original to value had one.
  if (
    toPathname &&
    toPathname !== '/' &&
    toPathname.endsWith('/') &&
    !path.pathname.endsWith('/')
  ) {
    path.pathname += '/';
  }

  return path;
}

function getToPathname(to: To): string | undefined {
  // Empty strings should be treated the same as / paths
  return to === '' || (to as Path).pathname === ''
    ? '/'
    : typeof to === 'string'
    ? parsePath(to).pathname
    : to.pathname;
}

function stripBasename(pathname: string, basename: string): string | null {
  if (basename === '/') return pathname;

  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) {
    return null;
  }

  let nextChar = pathname.charAt(basename.length);
  if (nextChar && nextChar !== '/') {
    // pathname does not start with basename/
    return null;
  }

  return pathname.slice(basename.length) || '/';
}

const joinPaths = (paths: string[]): string =>
  paths.join('/').replace(/\/\/+/g, '/');

const normalizePathname = (pathname: string): string =>
  pathname.replace(/\/+$/, '').replace(/^\/*/, '/');

const normalizeSearch = (search: string): string =>
  !search || search === '?'
    ? ''
    : search.startsWith('?')
    ? search
    : '?' + search;

const normalizeHash = (hash: string): string =>
  !hash || hash === '#' ? '' : hash.startsWith('#') ? hash : '#' + hash;

Route your web application with effector.

## Installation

```sh
npm install effector history @miizzo/effector-router
```
## Usage example

```js
import { guard } from 'effector';
import { pushed, $pathname } from '@miizzo/effector-router';

guard({
  clock: $pathname,
  filter: (pathname) => pathname === '/',
  target: pushed.prepend(() => '/home'), 
});
```

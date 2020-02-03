import { FCBot } from "../bot/main";

if (process.env.NODE_ENV !== 'production'){
    require('longjohn');
  }

new FCBot();

const { EventEmitter } = require('events');


const bus = new EventEmitter();
bus.setMaxListeners(20);

module.exports = bus;

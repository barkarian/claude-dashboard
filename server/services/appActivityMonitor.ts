import type { Server as SocketIOServer } from 'socket.io';
import type { AppActivityEventUnion } from '../../shared/types/appActivity.ts';

const MAX_EVENTS_PER_PORT = 2000;

// In-memory event buffers keyed by port
const eventBuffers = new Map<number, AppActivityEventUnion[]>();

// Ports currently being monitored (have at least one subscriber)
const monitoredPorts = new Set<number>();

let io: SocketIOServer | null = null;

function init(socketIO: SocketIOServer): void {
  io = socketIO;
}

function isMonitored(port: number): boolean {
  return monitoredPorts.has(port);
}

function startMonitoring(port: number): void {
  monitoredPorts.add(port);
  if (!eventBuffers.has(port)) {
    eventBuffers.set(port, []);
  }
  console.log(`[app-monitor] Started monitoring port ${port}`);
}

function stopMonitoring(port: number): void {
  monitoredPorts.delete(port);
  console.log(`[app-monitor] Stopped monitoring port ${port}`);
}

function clearEvents(port: number): void {
  eventBuffers.set(port, []);
}

function clearAllForPort(port: number): void {
  monitoredPorts.delete(port);
  eventBuffers.delete(port);
}

/**
 * Ingest events received from the injected monitoring script.
 * Stores them in the buffer and emits via Socket.IO to subscribers.
 */
function ingestEvents(port: number, events: AppActivityEventUnion[]): void {
  if (!monitoredPorts.has(port)) return;

  let buffer = eventBuffers.get(port);
  if (!buffer) {
    buffer = [];
    eventBuffers.set(port, buffer);
  }

  buffer.push(...events);

  // Trim if over limit
  if (buffer.length > MAX_EVENTS_PER_PORT) {
    buffer.splice(0, buffer.length - MAX_EVENTS_PER_PORT);
  }

  // Emit to subscribers in the room
  if (io) {
    io.to(`app-activity:${port}`).emit('app-activity:events', { port, events });
  }
}

function getEvents(port: number): AppActivityEventUnion[] {
  return eventBuffers.get(port) || [];
}

function getMonitoredPorts(): number[] {
  return Array.from(monitoredPorts);
}

/**
 * Generate the JavaScript monitoring script to inject into HTML responses.
 * This script overrides console.*, intercepts fetch/XHR, and captures errors.
 * Events are POSTed back to /__appmonitor/events on the same origin.
 */
function getMonitorScript(port: number): string {
  return `<script data-appmonitor="true">
(function(){
  if(window.__appMonitorInjected)return;
  window.__appMonitorInjected=true;
  var P=${port},Q=[],T=null,MAX=50;
  function flush(){
    if(!Q.length)return;
    var batch=Q.splice(0,MAX);
    try{
      navigator.sendBeacon("/__appmonitor/events",JSON.stringify({port:P,events:batch}));
    }catch(e){
      try{
        var x=new XMLHttpRequest();
        x.open("POST","/__appmonitor/events",true);
        x.setRequestHeader("Content-Type","application/json");
        x.send(JSON.stringify({port:P,events:batch}));
      }catch(e2){}
    }
  }
  function enqueue(evt){Q.push(evt);if(!T)T=setTimeout(function(){T=null;flush()},500);}
  function safe(v){try{if(typeof v==="object")return JSON.stringify(v).slice(0,500);return String(v).slice(0,500)}catch(e){return String(v).slice(0,500)}}
  var orig={};
  ["log","warn","error","info","debug"].forEach(function(m){
    orig[m]=console[m];
    console[m]=function(){
      orig[m].apply(console,arguments);
      enqueue({ts:Date.now(),type:"console",port:P,level:m,args:Array.prototype.slice.call(arguments).map(safe)});
    };
  });
  window.addEventListener("error",function(e){
    enqueue({ts:Date.now(),type:"error",port:P,message:e.message||"Unknown error",source:e.filename,lineno:e.lineno,colno:e.colno,stack:e.error&&e.error.stack?e.error.stack.slice(0,1000):undefined});
  });
  window.addEventListener("unhandledrejection",function(e){
    var msg=e.reason?String(e.reason.message||e.reason).slice(0,500):"Unhandled promise rejection";
    enqueue({ts:Date.now(),type:"error",port:P,message:msg,stack:e.reason&&e.reason.stack?e.reason.stack.slice(0,1000):undefined});
  });
  var origFetch=window.fetch;
  if(origFetch){
    window.fetch=function(){
      var url=arguments[0],opts=arguments[1]||{};
      var method=(opts.method||"GET").toUpperCase();
      var urlStr=typeof url==="string"?url:(url&&url.url?url.url:String(url));
      if(urlStr.indexOf("/__appmonitor/")!==-1)return origFetch.apply(this,arguments);
      var start=Date.now();
      return origFetch.apply(this,arguments).then(function(res){
        enqueue({ts:Date.now(),type:"network",port:P,method:method,url:urlStr.slice(0,500),status:res.status,durationMs:Date.now()-start,responseType:res.headers.get("content-type")||undefined});
        return res;
      }).catch(function(err){
        enqueue({ts:Date.now(),type:"network",port:P,method:method,url:urlStr.slice(0,500),status:0,durationMs:Date.now()-start});
        throw err;
      });
    };
  }
  var origXHROpen=XMLHttpRequest.prototype.open;
  var origXHRSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){
    this.__am={method:m,url:String(u).slice(0,500)};
    return origXHROpen.apply(this,arguments);
  };
  XMLHttpRequest.prototype.send=function(){
    var self=this,info=self.__am;
    if(!info||info.url.indexOf("/__appmonitor/")!==-1)return origXHRSend.apply(this,arguments);
    var start=Date.now();
    self.addEventListener("loadend",function(){
      enqueue({ts:Date.now(),type:"network",port:P,method:(info.method||"GET").toUpperCase(),url:info.url,status:self.status,durationMs:Date.now()-start,responseType:self.getResponseHeader("content-type")||undefined});
    });
    return origXHRSend.apply(this,arguments);
  };
  window.addEventListener("beforeunload",function(){flush()});
})();
</script>`;
}

export default {
  init,
  isMonitored,
  startMonitoring,
  stopMonitoring,
  clearEvents,
  clearAllForPort,
  ingestEvents,
  getEvents,
  getMonitoredPorts,
  getMonitorScript,
};

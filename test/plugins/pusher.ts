import { Adapter, Plugin } from 'zhin';
import type {} from '@zhinjs/adapter-onebot-12';
const pusher = new Plugin('消息推送');
pusher.waitServices('database');
type PusherConfig = {
  unique_id: string;
  group_id: string;
  service: string;
  interval: number;
};
type PushResult = {
  unique_id: string;
  group_id: string;
  message: string;
};
type Service = (group_id: string) => Promise<string[]>;
const createSicauService = (key: '四川农业大学通知服务' | '四川农业大学二课提醒') => {
  let cacheMap: Map<string, string[]> = new Map<string, string[]>();
  return async (group_id: string): Promise<string[]> => {
    if (cacheMap.has(key)) return cacheMap.get(key)!;
    const res = await fetch('https://api.sicau.cn/api/v1/group/list');
    const data = await res.json();
    cacheMap.set('四川农业大学通知服务', data.notice || []);
    cacheMap.set('四川农业大学二课提醒', data.isicau || []);
    setTimeout(
      () => {
        cacheMap.clear();
      },
      1000 * 60 * 60,
    ); // 缓存一小时清理
    return cacheMap.get(key)!;
  };
};
const serviceMap: Map<string, Service> = new Map<string, Service>();
serviceMap.set('四川农业大学通知服务', createSicauService('四川农业大学通知服务'));
serviceMap.set('四川农业大学二课提醒', createSicauService('四川农业大学二课提醒'));

let timer: NodeJS.Timeout;
pusher.command('添加推送').action<'onebot-12'>(async ({ bot, prompt }) => {
  const groupList = await bot.getGroupList();
  const pushGroup = await prompt.pick('请选择推送的群', {
    type: 'text',
    options: groupList.map(group => {
      return {
        label: group.group_name,
        value: group.group_id,
      };
    }),
  });
  const useService = await prompt.pick('请选择推送服务', {
    type: 'text',
    options: Array.from(serviceMap.keys()).map(name => {
      return {
        label: name,
        value: name,
      };
    }),
  });
  await pusher.database.push('pusher_config', {
    unique_id: bot.unique_id,
    group_id: pushGroup,
    service: useService,
  });
  return '添加成功';
});
pusher.mounted(app => {
  const receiveAndPush = async () => {
    const configs = (await pusher.database.get<PusherConfig[]>('pusher_config', [])) || [];
    for (const config of configs) {
      const bot = app.adapters
        .get('onebot-12')
        ?.bots.find(b => b.unique_id === config.unique_id) as unknown as Adapter.Bot<'onebot-12'>;
      if (!bot) return;
      const service = serviceMap.get(config.service);
      if (service) {
        const messages = await service(config.group_id);
        for (const message of messages) {
          await bot.sendGroupMsg(config.group_id, message);
          await pusher.database.push<PushResult>('pusher_infos', {
            unique_id: bot.unique_id,
            group_id: config.group_id,
            message,
          });
        }
      }
    }
  };
  const pushWithLoop = (delay: number) => {
    timer = setTimeout(() => {
      receiveAndPush().then(() => {
        pushWithLoop(delay);
      });
    }, delay);
  };
  receiveAndPush().then(() => {
    pushWithLoop(1000 * 60 * 60 * 3);
  });
});
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  getDistance(point: Point) {
    return Math.sqrt(Math.pow(point.x - this.x, 2) + Math.pow(point.y - this.y, 2));
  }
}
class Circle {
  constructor(
    public center: Point,
    public radius: number,
  ) {}
  isIntersect(circle: Circle) {
    return this.center.getDistance(circle.center) < this.radius + circle.radius;
  }
  get area() {
    return Math.PI * Math.pow(this.radius, 2);
  }
  get perimeter() {
    return 2 * this.radius * Math.PI;
  }
}
class Rect {
  constructor(
    public x: Point,
    public y: Point,
  ) {}
  isIntersect(rect: Rect) {}
  get center() {
    return new Point(Math.abs(this.x.x - this.y.x) / 2, Math.abs(this.x.y - this.y.y) / 2);
  }
  get width() {
    return Math.abs(this.x.x - this.y.x);
  }
  get height() {
    return Math.abs(this.x.y - this.y.y);
  }
  get area() {
    return 2 * (this.width + this.height);
  }
  get perimeter() {
    return this.width * this.height;
  }
}
pusher.beforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
export default pusher;

import type { JSXNode } from "@zhin.js/jsx";
import {
  Badge,
  Checkbox,
  List,
  ListItem,
  ThemeProvider,
} from "../src/index.js";

async function AsyncItem(): Promise<JSXNode> {
  return <Badge>异步</Badge>;
}

export const listTypeFixtures = [
  <ThemeProvider
    theme={{
      text: { listMarker: <b>→</b> },
      components: { ListItem: { margin: "8px 0" } },
    }}
  >
    <List items={[0, <strong>项目</strong>, AsyncItem()]} />
  </ThemeProvider>,
  <List ordered start={0}>
    <ListItem custom={{ text: { marker: <em>一</em> } }}>
      {AsyncItem()}
    </ListItem>
    <>
      <ListItem>
        内容
        <List items={["子项目"]} />
      </ListItem>
    </>
  </List>,
  <List>
    <ListItem marker={<Checkbox checked custom={{ style: { margin: 0 } }} />}>
      任务
    </ListItem>
    <ListItem marker={false}>无标记</ListItem>
  </List>,
];

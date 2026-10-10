import type { JSXNode } from "@zhin.js/jsx";
import {
  Badge,
  Row,
  Table,
  TableCell,
  TableRow,
  ThemeProvider,
} from "../src/index.js";

async function AsyncCell(): Promise<JSXNode> {
  return <Badge>异步状态</Badge>;
}

export const tableTypeFixtures = [
  <ThemeProvider
    theme={{
      components: { Table: { borderRadius: 20 }, TableCell: { padding: 8 } },
    }}
  >
    <Table
      caption={<strong>列表</strong>}
      headers={["名称", <em>状态</em>]}
      rows={[[0, AsyncCell()]]}
      custom={{ text: { caption: AsyncCell() } }}
    />
  </ThemeProvider>,
  <Table>
    <TableRow header separator={false}>
      <TableCell header width={80}>
        名称
      </TableCell>
      <TableCell header align="right">
        状态
      </TableCell>
    </TableRow>
    <TableRow>
      <TableCell width="40%">
        <strong>Gateway</strong>
      </TableCell>
      <TableCell align="center">
        <Row gap={8}>
          <Badge>在线</Badge>
          {AsyncCell()}
        </Row>
      </TableCell>
    </TableRow>
  </Table>,
];

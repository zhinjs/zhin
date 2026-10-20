import type { JSXNode } from "@zhin.js/jsx";
import { Button, Checkbox, Radio, Switch } from "../src/controls.js";

async function AsyncLabel(): Promise<JSXNode> {
  return <b>Ready</b>;
}

export const controlsFixtures = [
  <Checkbox checked ariaLabel="Ready" label={AsyncLabel()} />,
  <Radio disabled ariaLabel="Ready">{AsyncLabel()}</Radio>,
  <Switch checked disabled ariaLabel="Ready" custom={{ text: { label: AsyncLabel() } }} />,
  <Button variant="danger" size="sm">
    {AsyncLabel()}
  </Button>,
];

export const interactiveButton = (
  // @ts-expect-error Display controls do not bind interactions.
  <Button onClick={() => undefined}>Action</Button>
);

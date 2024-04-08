import { h } from 'vue';
import './test.css';
export default (props: { who: string }) => {
  return <div>{props.who}</div>;
};

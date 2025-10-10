// 测试语法
import { Component } from './packages/core/lib/component.js';

// 定义测试用的函数式组件
function Test(props: { foo: string; bar: number; children?: string }) {
    return props;
}

// 测试基本功能
console.log('测试 getProps 函数...');

// 测试自闭合标签
const result1 = Component.getProps(Test, '<Test foo="123" bar={345}/>');
console.log('自闭合标签:', result1);

// 测试闭合标签
const result2 = Component.getProps(Test, '<Test foo="hello" bar={200}>world</Test>');
console.log('闭合标签:', result2);

console.log('测试完成');

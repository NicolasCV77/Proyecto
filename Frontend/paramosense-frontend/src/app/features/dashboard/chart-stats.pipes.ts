import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'minVal', standalone: true })
export class MinValPipe implements PipeTransform {
  transform(values: number[]): string {
    if (!values.length) return '—';
    return Math.min(...values).toFixed(1);
  }
}

@Pipe({ name: 'maxVal', standalone: true })
export class MaxValPipe implements PipeTransform {
  transform(values: number[]): string {
    if (!values.length) return '—';
    return Math.max(...values).toFixed(1);
  }
}

@Pipe({ name: 'avgVal', standalone: true })
export class AvgValPipe implements PipeTransform {
  transform(values: number[]): string {
    if (!values.length) return '—';
    return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
  }
}

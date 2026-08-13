#!/bin/bash
cd /c/Users/LG/Documents/quant_invest
git add public/data/
git commit -m "data: 7팩터 메타 + 종목별 (Sharpe-균형 가중치)"
git push origin main
echo "DONE: $?"

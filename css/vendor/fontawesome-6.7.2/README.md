# Font Awesome Free 6.7.2

来源：官方 npm 包 `@fortawesome/fontawesome-free@6.7.2`。完整许可在 LICENSE.txt。

`all.min.css` 保留本站用到的上游图标规则、别名和通用工具类，修改字体路径、font-display 与 unicode-range。添加图标后重跑生成脚本，普通构建无需 Python。
`*-site.woff2` 是本项目生成的字体子集，内部名称改为 Lks Icons，版权和 OFL 许可保留。
完整 WOFF2 原文件未修改，作为剩余码位的按需后备：新图标仍能显示，不需要先重新生成子集。

生成脚本：`tools/prepare-icon-fonts.py`；只用于维护，普通构建和 CI 不需要 Python。

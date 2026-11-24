# 雅思词源

使用 ECDICT 固定提交 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b` 的 `ecdict.csv`，提取标签字段中含 `ielts` 的词条。该标签由词典维护者整理，适合作为备考选词范围。仓库随附 MIT 许可。提交、原文件及提取快照的 SHA-256 见 [来源记录](source.json)。[固定提交](https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b) · [许可](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE)

比较过 LynnShaw 的雅思复习词表，其公开页面未附词表的分发许可。ECDICT 具有固定的标签、词频字段及英中内容，适合做可重复构建的数据源。[对比词表](https://github.com/LynnShaw/vocabulary_for_ielts)

快照保留英文、原中文释义、BNC 和语料库词频排名以及词形信息。原始 CSV 可用 `python scripts/extract-ielts-source.py <原始CSV> data/upstream/ielts/ecdict-ielts.json` 重新提取。项目构建直接读取已固定的子集，离线可重建题库。

筛除清单和熟词生义例外见 [雅思基础词筛除](../../review/雅思基础词筛除.md)。核心义从原词条的中文义项中摘录。可运行 `npm run check:ielts-questions -- --sample` 查看跨不同词频层的样题。

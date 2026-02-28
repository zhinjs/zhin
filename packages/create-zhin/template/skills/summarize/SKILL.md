---
name: summarize
description: "Summarize web articles, documents, or long text into concise key points. Supports brief summary, bullet points, and structured formats."
---

# Summarize

Condense URLs, local files, or user-provided long text into readable summaries.

## Summarize a URL

1. Use `web_fetch` to retrieve the page content
2. Extract and summarize key points

## Summarize a Local File

1. Use `read_file` to load the content
2. Summarize it

## Output Formats

- **Brief**: 2–3 sentences capturing the essence
- **Key Points**: 5–7 bullet points with important figures and quotes
- **Structured**: Sections — TL;DR, key findings, details, action items
- **Report**: For business/technical docs — overview, findings, recommendations, next steps

## Notes

- Default to the source language; translate if the user specifies a language
- Preserve important numbers, dates, and names
- For long content, summarize in sections and note the content type (news, research, blog, etc.)

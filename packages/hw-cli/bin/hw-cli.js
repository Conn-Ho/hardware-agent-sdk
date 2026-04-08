#!/usr/bin/env node
import { Command } from 'commander'
import { registerSearch } from '../src/commands/search.js'
import { registerBom } from '../src/commands/bom.js'
import { registerSources } from '../src/commands/sources.js'

const program = new Command()

program
  .name('hw-cli')
  .description('Hardware Agent SDK — 硬件元件搜索 & BOM 比价工具')
  .version('0.1.0')

registerSearch(program)
registerBom(program)
registerSources(program)

program.parse()

/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/


import * as zrUtil from 'zrender/src/core/util';
import createListSimply from '../helper/createListSimply';
import SeriesModel from '../../model/Series';
import {encodeHTML, addCommas} from '../../util/format';
import {DataSelectableMixin, DataSelectableOptionMixin, SelectableTarget} from '../../component/helper/selectableMixin';
import {retrieveRawAttr} from '../../data/helper/dataProvider';
import geoSourceManager from '../../coord/geo/geoSourceManager';
import {makeSeriesEncodeForNameBased} from '../../data/helper/sourceHelper';
import { SeriesOption, BoxLayoutOptionMixin, SeriesEncodeOptionMixin, LabelOption, SeriesTooltipOption, OptionDataItemObject, OptionDataValueNumeric, ParsedValue, SeriesOnGeoOptionMixin } from '../../util/types';
import { Dictionary } from 'zrender/src/core/types';
import GeoModel, { GeoCommonOptionMixin, GeoItemStyleOption } from '../../coord/geo/GeoModel';
import List from '../../data/List';
import Model from '../../model/Model';
import Geo from '../../coord/geo/Geo';

interface MapDataItemOption extends
    OptionDataItemObject<OptionDataValueNumeric>,
    SelectableTarget {

    itemStyle?: GeoItemStyleOption
    label?: LabelOption

    emphasis?: {
        itemStyle?: GeoItemStyleOption
        label?: LabelOption
    }
}

export type MapValueCalculationType = 'sum' | 'average' | 'min' | 'max';

export interface MapSeriesOption extends
    SeriesOption,
    GeoCommonOptionMixin,
    // If `geoIndex` is not specified, a exclusive geo will be
    // created. Otherwise use the specified geo component, and
    // `map` and `mapType` are ignored.
    SeriesOnGeoOptionMixin,
    BoxLayoutOptionMixin,
    DataSelectableOptionMixin,
    SeriesEncodeOptionMixin {

    coordinateSystem?: string;
    silent?: boolean;

    // FIXME:TS formatter?
    label?: LabelOption;
    itemStyle?: GeoItemStyleOption;

    tooltip?: SeriesTooltipOption;

    // FIXME:TS add marker types
    markLine?: any;
    markPoint?: any;
    markArea?: any;

    mapValueCalculation?: MapValueCalculationType;

    showLegendSymbol?: boolean;

    // @deprecated. Only for echarts2 backward compat.
    geoCoord?: Dictionary<number[]>;

    data?: OptionDataValueNumeric[] | OptionDataValueNumeric[][] | MapDataItemOption[]

    emphasis?: {
        // FIXME:TS formatter?
        label?: LabelOption;
        itemStyle?: GeoItemStyleOption;
    };
}

class MapSeries extends SeriesModel<MapSeriesOption> {

    static type = 'series.map' as const;
    type = MapSeries.type;

    static dependencies = ['geo'];

    static layoutMode = 'box' as const;

    coordinateSystem: Geo;

    // -----------------
    // Injected outside
    originalData: List;
    mainSeries: MapSeries;
    // Only first map series of same mapType will drawMap.
    needsDrawMap: boolean = false;
    // Group of all map series with same mapType
    seriesGroup: MapSeries[] = [];


    getInitialData(option: MapSeriesOption): List {
        var data = createListSimply(this, {
            coordDimensions: ['value'],
            encodeDefaulter: zrUtil.curry(makeSeriesEncodeForNameBased, this)
        });
        var valueDim = data.mapDimension('value');
        var dataNameMap = zrUtil.createHashMap();
        var selectTargetList = [];
        var toAppendNames = [] as string[];

        for (var i = 0, len = data.count(); i < len; i++) {
            var name = data.getName(i);
            dataNameMap.set(name, true);
            selectTargetList.push({
                name: name,
                value: data.get(valueDim, i),
                selected: retrieveRawAttr(data, i, 'selected')
            });
        }

        var geoSource = geoSourceManager.load(this.getMapType(), this.option.nameMap);
        zrUtil.each(geoSource.regions, function (region) {
            var name = region.name;
            if (!dataNameMap.get(name)) {
                selectTargetList.push({name: name});
                toAppendNames.push(name);
            }
        });

        this.updateSelectedMap(selectTargetList);

        // Complete data with missing regions. The consequent processes (like visual
        // map and render) can not be performed without a "full data". For example,
        // find `dataIndex` by name.
        data.appendValues([], toAppendNames);

        return data;
    }

    /**
     * If no host geo model, return null, which means using a
     * inner exclusive geo model.
     */
    getHostGeoModel(): GeoModel {
        var geoIndex = this.option.geoIndex;
        return geoIndex != null
            ? this.dependentModels.geo[geoIndex] as GeoModel
            : null;
    }

    getMapType(): string {
        return (this.getHostGeoModel() || this).option.map;
    }

    // _fillOption(option, mapName) {
        // Shallow clone
        // option = zrUtil.extend({}, option);

        // option.data = geoCreator.getFilledRegions(option.data, mapName, option.nameMap);

        // return option;
    // }

    getRawValue(dataIndex: number): ParsedValue {
        // Use value stored in data instead because it is calculated from multiple series
        // FIXME Provide all value of multiple series ?
        var data = this.getData();
        return data.get(data.mapDimension('value'), dataIndex);
    }

    /**
     * Get model of region
     */
    getRegionModel(regionName: string): Model<MapDataItemOption> {
        var data = this.getData();
        return data.getItemModel(data.indexOfName(regionName));
    }

    /**
     * Map tooltip formatter
     */
    formatTooltip(dataIndex: number): string {
        // FIXME orignalData and data is a bit confusing
        var data = this.getData();
        var formattedValue = addCommas(this.getRawValue(dataIndex));
        var name = data.getName(dataIndex);

        var seriesGroup = this.seriesGroup;
        var seriesNames = [];
        for (var i = 0; i < seriesGroup.length; i++) {
            var otherIndex = seriesGroup[i].originalData.indexOfName(name);
            var valueDim = data.mapDimension('value');
            if (!isNaN(seriesGroup[i].originalData.get(valueDim, otherIndex) as number)) {
                seriesNames.push(
                    encodeHTML(seriesGroup[i].name)
                );
            }
        }

        return seriesNames.join(', ') + '<br />'
            + encodeHTML(name + ' : ' + formattedValue);
    }

    getTooltipPosition = function (this: MapSeries, dataIndex: number): number[] {
        if (dataIndex != null) {
            var name = this.getData().getName(dataIndex);
            var geo = this.coordinateSystem;
            var region = geo.getRegion(name);

            return region && geo.dataToPoint(region.center);
        }
    };

    setZoom(zoom: number): void {
        this.option.zoom = zoom;
    }

    setCenter(center: number[]): void {
        this.option.center = center;
    }

    static defaultOption: MapSeriesOption = {
        // 一级层叠
        zlevel: 0,
        // 二级层叠
        z: 2,

        coordinateSystem: 'geo',

        // map should be explicitly specified since ec3.
        map: '',

        // If `geoIndex` is not specified, a exclusive geo will be
        // created. Otherwise use the specified geo component, and
        // `map` and `mapType` are ignored.
        // geoIndex: 0,

        // 'center' | 'left' | 'right' | 'x%' | {number}
        left: 'center',
        // 'center' | 'top' | 'bottom' | 'x%' | {number}
        top: 'center',
        // right
        // bottom
        // width:
        // height

        // Aspect is width / height. Inited to be geoJson bbox aspect
        // This parameter is used for scale this aspect
        aspectScale: 0.75,

        ///// Layout with center and size
        // If you wan't to put map in a fixed size box with right aspect ratio
        // This two properties may more conveninet
        // layoutCenter: [50%, 50%]
        // layoutSize: 100

        showLegendSymbol: true,

        // Define left-top, right-bottom coords to control view
        // For example, [ [180, 90], [-180, -90] ],
        // higher priority than center and zoom
        boundingCoords: null,

        // Default on center of map
        center: null,

        zoom: 1,

        scaleLimit: null,

        label: {
            show: false,
            color: '#000'
        },
        // scaleLimit: null,
        itemStyle: {
            borderWidth: 0.5,
            borderColor: '#444',
            areaColor: '#eee'
        },

        emphasis: {
            label: {
                show: true,
                color: 'rgb(100,0,0)'
            },
            itemStyle: {
                areaColor: 'rgba(255,215,0,0.8)'
            }
        }
    }

}

interface MapSeries extends DataSelectableMixin<MapSeriesOption> {}
zrUtil.mixin(MapSeries, DataSelectableMixin);

export default MapSeries;